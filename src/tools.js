import { config } from "./config.js";

export const toolDefinitions = [
  {
    type: "function",
    name: "get_weather",
    description: "查詢台灣縣市或鄉鎮市區天氣預報，適合回答會不會下雨、氣溫、天氣概況。",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "台灣縣市或鄉鎮市區，例如臺北市、新北市、淡水區、淡水"
        }
      },
      required: ["city"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "search_food",
    description: "搜尋台灣餐廳或附近美食。若使用者提供 LINE 位置，優先用經緯度搜尋。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "餐廳或料理關鍵字，例如西湖市場美食、牛肉麵、咖啡、拉麵"
        },
        city: {
          type: "string",
          description: "城市或區域，例如台北車站、信義區、西湖市場"
        },
        latitude: {
          type: "number",
          description: "使用者位置緯度"
        },
        longitude: {
          type: "number",
          description: "使用者位置經度"
        },
        openNow: {
          type: "boolean",
          description: "是否只找目前營業中的餐廳"
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

export async function runTool(name, args, context = {}) {
  try {
    switch (name) {
      case "get_weather":
        return getWeather(args);
      case "search_food":
        return searchFood({ ...args, ...locationFallback(args, context.location) });
      default:
        return {
          ok: false,
          error: `Unknown tool: ${name}`
        };
    }
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      providerError: true,
      source: inferToolSource(name),
      message: normalizeProviderError(error)
    };
  }
}

export async function getWeather({ city }) {
  const location = resolveWeatherLocation(city);
  if (!config.providers.cwaApiKey) {
    return {
      ok: false,
      needsConfiguration: "CWA_API_KEY",
      city: location.city,
      locality: location.locality,
      message: `尚未設定中央氣象署 API key。設定後可查詢 ${location.displayName} 的天氣預報。`
    };
  }

  if (location.locality) {
    const township = await getTownshipWeather(location);
    if (township.ok) return township;
  }

  return getCountyWeather(location);
}

export async function searchFood({ query, city, latitude, longitude, openNow = false }) {
  if (!config.providers.googlePlacesApiKey) {
    return {
      ok: false,
      needsConfiguration: "GOOGLE_PLACES_API_KEY",
      message: "尚未設定 Google Places API key。設定後可依位置或地區搜尋餐廳。"
    };
  }

  if (isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
    return searchFoodByText({
      textQuery: `${query} 餐廳`,
      latitude,
      longitude,
      openNow,
      source: "Google Places Text Search with locationBias"
    });
  }

  const textQuery = [city, query, "餐廳"].filter(Boolean).join(" ");
  return searchFoodByText({
    textQuery,
    openNow,
    source: "Google Places Text Search"
  });
}

async function getTownshipWeather(location) {
  const url = new URL("https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089");
  url.searchParams.set("Authorization", config.providers.cwaApiKey);
  url.searchParams.set("locationName", location.locality);

  const data = await fetchJson(url);
  const township = findTownshipLocation(data, location.locality);
  if (!township) {
    return {
      ok: false,
      city: location.city,
      locality: location.locality,
      message: `查不到 ${location.locality} 的鄉鎮預報，將改查 ${location.city}。`
    };
  }

  return {
    ok: true,
    source: "CWA F-D0047-089",
    city: location.city,
    locality: location.locality,
    displayName: location.locality,
    forecast: summarizeTownshipElements(township.WeatherElement || township.weatherElement || []),
    note: "此為中央氣象署鄉鎮市區預報。"
  };
}

async function getCountyWeather(location) {
  const url = new URL("https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001");
  url.searchParams.set("Authorization", config.providers.cwaApiKey);
  url.searchParams.set("locationName", location.city);

  const data = await fetchJson(url);
  const county = data.records?.location?.[0];
  const elements = county?.weatherElement || [];

  return {
    ok: Boolean(county),
    source: "CWA F-C0032-001",
    city: location.city,
    displayName: location.displayName,
    message: county ? "" : `查不到 ${location.displayName} 的天氣資訊。`,
    forecast: elements.map((element) => ({
      name: element.elementName,
      periods: (element.time || []).slice(0, 3).map((period) => ({
        startTime: period.startTime,
        endTime: period.endTime,
        value: period.parameter?.parameterName,
        unit: period.parameter?.parameterUnit || ""
      }))
    }))
  };
}

async function searchFoodByText({ textQuery, latitude, longitude, openNow, source }) {
  const body = {
    textQuery,
    languageCode: "zh-TW",
    regionCode: "TW",
    includedType: "restaurant",
    maxResultCount: 20,
    openNow
  };

  if (isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
    body.locationBias = {
      circle: {
        center: { latitude, longitude },
        radius: 1500
      }
    };
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.providers.googlePlacesApiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.shortFormattedAddress,places.rating,places.googleMapsUri,places.websiteUri,places.primaryType,places.primaryTypeDisplayName,places.types,places.currentOpeningHours"
    },
    body: JSON.stringify(body)
  });

  return normalizePlacesResponse(await readJsonResponse(response), source);
}

function findTownshipLocation(data, locality) {
  const groups = data.records?.Locations || data.records?.locations || [];
  for (const group of groups) {
    const locations = group.Location || group.location || [];
    const found = locations.find((item) => {
      const name = item.LocationName || item.locationName || item.locationName;
      return name === locality;
    });
    if (found) return found;
  }
  return null;
}

function summarizeTownshipElements(elements) {
  const wanted = new Set(["天氣現象", "降雨機率", "溫度", "體感溫度", "舒適度指數", "最高溫度", "最低溫度", "Wx", "PoP", "T", "AT", "CI", "MaxT", "MinT"]);
  return elements
    .filter((element) => wanted.has(element.ElementName || element.elementName))
    .slice(0, 7)
    .map((element) => ({
      name: element.ElementName || element.elementName,
      periods: (element.Time || element.time || []).slice(0, 3).map((period) => ({
        startTime: period.StartTime || period.startTime,
        endTime: period.EndTime || period.endTime,
        value: extractElementValue(period.ElementValue || period.elementValue || period.parameter),
        unit: extractElementUnit(period.ElementValue || period.elementValue || period.parameter)
      }))
    }));
}

function extractElementValue(value) {
  if (!value) return "";
  if (!Array.isArray(value)) {
    return value.Value || value.value || value.ParameterName || value.parameterName || "";
  }
  return value
    .map((item) => item.Value || item.value || item.Weather || item.WeatherDescription || item.Temperature || item.MaxTemperature || item.MinTemperature || item.ProbabilityOfPrecipitation || item.ComfortIndexDescription || "")
    .filter(Boolean)
    .join(" / ");
}

function extractElementUnit(value) {
  if (!value) return "";
  if (!Array.isArray(value)) return value.Measures || value.measures || value.ParameterUnit || value.parameterUnit || "";
  return value.map((item) => item.Measures || item.measures || "").filter(Boolean)[0] || "";
}

function normalizePlacesResponse(data, source) {
  const candidates = (data.places || []).map((place) => ({
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    shortAddress: place.shortFormattedAddress || "",
    rating: place.rating || null,
    mapsUrl: place.googleMapsUri || "",
    websiteUrl: place.websiteUri || "",
    primaryType: place.primaryType || "",
    primaryTypeName: place.primaryTypeDisplayName?.text || "",
    types: Array.isArray(place.types) ? place.types : [],
    categories: formatPlaceCategories(place),
    openNow: place.currentOpeningHours?.openNow
  }));
  const place = pickRandom(candidates);

  return {
    ok: Boolean(place),
    source,
    places: place ? [place] : [],
    candidateCount: candidates.length,
    message: place ? "" : "找不到符合條件的餐廳。"
  };
}

function pickRandom(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function formatPlaceCategories(place) {
  const labels = [
    place.primaryTypeDisplayName?.text,
    translatePlaceType(place.primaryType),
    ...(Array.isArray(place.types) ? place.types.map(translatePlaceType) : [])
  ]
    .filter(Boolean)
    .filter((label) => !genericPlaceTypes.has(label));

  return [...new Set(labels)].slice(0, 3).join(" / ");
}

function translatePlaceType(type) {
  const normalized = String(type || "").trim();
  if (!normalized) return "";
  return placeTypeLabels.get(normalized) || normalized.replace(/_/g, " ");
}

function locationFallback(args, location) {
  if (!location) return {};
  if (isFiniteNumber(args.latitude) && isFiniteNumber(args.longitude)) return {};
  return {
    latitude: location.latitude,
    longitude: location.longitude
  };
}

export function resolveWeatherLocation(input) {
  const raw = String(input || "").trim();
  const locality = normalizeTownship(raw);
  if (locality) {
    return {
      city: townshipCountyMap.get(locality) || "新北市",
      locality,
      displayName: locality
    };
  }

  const city = normalizeTaiwanCity(raw);
  return {
    city,
    locality: "",
    displayName: city
  };
}

export function normalizeTaiwanCity(city) {
  const input = String(city || "").trim();
  return cityAliases.get(input) || input || "臺北市";
}

function normalizeTownship(input) {
  if (!input) return "";
  if (townshipCountyMap.has(input)) return input;
  const withDistrict = `${input}區`;
  if (townshipCountyMap.has(withDistrict)) return withDistrict;
  const withTown = `${input}鎮`;
  if (townshipCountyMap.has(withTown)) return withTown;
  const withTownship = `${input}鄉`;
  if (townshipCountyMap.has(withTownship)) return withTownship;
  return "";
}

async function fetchJson(url) {
  const response = await fetch(url);
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeProviderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("API key not valid") || message.includes("REQUEST_DENIED")) {
    return "Google Places API key 無效，或尚未啟用 Places API。";
  }
  if (message.includes("BillingNotEnabledMapError") || message.includes("billing")) {
    return "Google Places 需要啟用 Google Cloud billing。";
  }
  if (message.includes("PERMISSION_DENIED")) {
    return "Google Cloud 專案尚未授權使用 Places API，請確認 API key 限制與 Places API 是否啟用。";
  }
  if (message.includes("Provider request failed: 403")) {
    return "Google Places 回傳 403。請確認 Google Cloud billing 已啟用、Places API / Places API (New) 已啟用，且 API key 沒有設成只能給瀏覽器網域或特定 IP 使用。";
  }
  return message.slice(0, 600);
}

function inferToolSource(name) {
  switch (name) {
    case "get_weather":
      return "CWA";
    case "search_food":
      return "Google Places";
    default:
      return "Unknown provider";
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const genericPlaceTypes = new Set([
  "地點",
  "餐飲",
  "point of interest",
  "establishment",
  "food"
]);

const placeTypeLabels = new Map([
  ["restaurant", "餐廳"],
  ["cafe", "咖啡廳"],
  ["bar", "酒吧"],
  ["bakery", "烘焙坊"],
  ["meal_takeaway", "外帶餐廳"],
  ["meal_delivery", "外送餐廳"],
  ["breakfast_restaurant", "早餐店"],
  ["brunch_restaurant", "早午餐"],
  ["chinese_restaurant", "中式餐廳"],
  ["taiwanese_restaurant", "台式餐廳"],
  ["japanese_restaurant", "日式餐廳"],
  ["korean_restaurant", "韓式餐廳"],
  ["thai_restaurant", "泰式餐廳"],
  ["vietnamese_restaurant", "越式餐廳"],
  ["italian_restaurant", "義式餐廳"],
  ["french_restaurant", "法式餐廳"],
  ["american_restaurant", "美式餐廳"],
  ["mexican_restaurant", "墨西哥餐廳"],
  ["indian_restaurant", "印度餐廳"],
  ["seafood_restaurant", "海鮮餐廳"],
  ["steak_house", "牛排館"],
  ["sushi_restaurant", "壽司店"],
  ["ramen_restaurant", "拉麵店"],
  ["barbecue_restaurant", "燒烤餐廳"],
  ["hot_pot_restaurant", "火鍋店"],
  ["vegetarian_restaurant", "素食餐廳"],
  ["vegan_restaurant", "純素餐廳"],
  ["pizza_restaurant", "披薩店"],
  ["hamburger_restaurant", "漢堡店"],
  ["ice_cream_shop", "冰淇淋店"],
  ["dessert_shop", "甜點店"],
  ["coffee_shop", "咖啡店"],
  ["sandwich_shop", "三明治店"],
  ["food_court", "美食街"],
  ["market", "市場"],
  ["night_market", "夜市"]
]);

const cityAliases = new Map([
  ["台北", "臺北市"],
  ["台北市", "臺北市"],
  ["臺北", "臺北市"],
  ["臺北市", "臺北市"],
  ["新北", "新北市"],
  ["新北市", "新北市"],
  ["桃園", "桃園市"],
  ["桃園市", "桃園市"],
  ["台中", "臺中市"],
  ["台中市", "臺中市"],
  ["臺中", "臺中市"],
  ["臺中市", "臺中市"],
  ["台南", "臺南市"],
  ["台南市", "臺南市"],
  ["臺南", "臺南市"],
  ["臺南市", "臺南市"],
  ["高雄", "高雄市"],
  ["高雄市", "高雄市"],
  ["基隆", "基隆市"],
  ["基隆市", "基隆市"],
  ["新竹", "新竹市"],
  ["新竹市", "新竹市"],
  ["嘉義", "嘉義市"],
  ["嘉義市", "嘉義市"],
  ["新竹縣", "新竹縣"],
  ["苗栗", "苗栗縣"],
  ["苗栗縣", "苗栗縣"],
  ["彰化", "彰化縣"],
  ["彰化縣", "彰化縣"],
  ["南投", "南投縣"],
  ["南投縣", "南投縣"],
  ["雲林", "雲林縣"],
  ["雲林縣", "雲林縣"],
  ["嘉義縣", "嘉義縣"],
  ["屏東", "屏東縣"],
  ["屏東縣", "屏東縣"],
  ["宜蘭", "宜蘭縣"],
  ["宜蘭縣", "宜蘭縣"],
  ["花蓮", "花蓮縣"],
  ["花蓮縣", "花蓮縣"],
  ["台東", "臺東縣"],
  ["台東縣", "臺東縣"],
  ["臺東", "臺東縣"],
  ["臺東縣", "臺東縣"],
  ["澎湖", "澎湖縣"],
  ["澎湖縣", "澎湖縣"],
  ["金門", "金門縣"],
  ["金門縣", "金門縣"],
  ["連江", "連江縣"],
  ["連江縣", "連江縣"]
]);

const townshipCountyMap = new Map([
  ["淡水區", "新北市"],
  ["八里區", "新北市"],
  ["三芝區", "新北市"],
  ["石門區", "新北市"],
  ["金山區", "新北市"],
  ["萬里區", "新北市"],
  ["板橋區", "新北市"],
  ["新莊區", "新北市"],
  ["中和區", "新北市"],
  ["永和區", "新北市"],
  ["三重區", "新北市"],
  ["蘆洲區", "新北市"],
  ["汐止區", "新北市"],
  ["新店區", "新北市"],
  ["土城區", "新北市"],
  ["樹林區", "新北市"],
  ["鶯歌區", "新北市"],
  ["三峽區", "新北市"],
  ["瑞芳區", "新北市"],
  ["林口區", "新北市"],
  ["五股區", "新北市"],
  ["泰山區", "新北市"],
  ["深坑區", "新北市"],
  ["石碇區", "新北市"],
  ["坪林區", "新北市"],
  ["三峽區", "新北市"],
  ["平溪區", "新北市"],
  ["雙溪區", "新北市"],
  ["貢寮區", "新北市"],
  ["烏來區", "新北市"],
  ["士林區", "臺北市"],
  ["北投區", "臺北市"],
  ["內湖區", "臺北市"],
  ["信義區", "臺北市"],
  ["中山區", "臺北市"],
  ["大安區", "臺北市"],
  ["松山區", "臺北市"],
  ["中正區", "臺北市"],
  ["萬華區", "臺北市"],
  ["文山區", "臺北市"],
  ["大同區", "臺北市"],
  ["南港區", "臺北市"]
]);
