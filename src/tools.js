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
  },
  {
    type: "function",
    name: "get_stock_quote",
    description: "查詢台股或美股報價摘要。僅提供資訊查詢，不提供投資建議。",
    parameters: {
      type: "object",
      properties: {
        market: {
          type: "string",
          enum: ["TW", "US"],
          description: "TW 代表台股，US 代表美股"
        },
        symbol: {
          type: "string",
          description: "股票代號，例如 2330 或 AAPL"
        }
      },
      required: ["market", "symbol"],
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
      case "get_stock_quote":
        return getStockQuote(args);
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

export async function getStockQuote({ market, symbol }) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  if (!cleanSymbol) {
    return {
      ok: false,
      message: "請提供股票代號，例如 2330 或 AAPL。"
    };
  }

  if (market === "TW") {
    return getTaiwanStockQuote(cleanSymbol);
  }

  return getUsStockQuote(cleanSymbol);
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
    maxResultCount: 5,
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
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.currentOpeningHours"
    },
    body: JSON.stringify(body)
  });

  return normalizePlacesResponse(await readJsonResponse(response), source);
}

async function getTaiwanStockQuote(symbol) {
  const code = symbol.replace(".TW", "");
  const data = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  const item = Array.isArray(data)
    ? data.find((row) => row.Code === code || row["證券代號"] === code)
    : null;

  if (!item) {
    return {
      ok: false,
      market: "TW",
      symbol: code,
      message: "找不到此台股代號，或公開資料尚未更新。"
    };
  }

  return {
    ok: true,
    market: "TW",
    symbol: code,
    name: item.Name || item["證券名稱"] || "",
    price: item.ClosingPrice || item["收盤價"] || "",
    change: item.Change || item["漲跌價差"] || "",
    volume: item.TradeVolume || item["成交股數"] || "",
    source: "TWSE OpenAPI STOCK_DAY_ALL",
    note: "台股資料以證交所公開資料為準，可能不是即時盤中報價。"
  };
}

async function getUsStockQuote(symbol) {
  if (!config.providers.finnhubApiKey) {
    return {
      ok: false,
      needsConfiguration: "FINNHUB_API_KEY",
      market: "US",
      symbol,
      message: "尚未設定 Finnhub API key。設定後可查詢美股報價摘要。"
    };
  }

  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", config.providers.finnhubApiKey);
  const quote = await fetchJson(url);

  return {
    ok: Boolean(quote && quote.c),
    market: "US",
    symbol,
    currentPrice: quote.c,
    change: quote.d,
    percentChange: quote.dp,
    high: quote.h,
    low: quote.l,
    open: quote.o,
    previousClose: quote.pc,
    timestamp: quote.t,
    source: "Finnhub quote",
    note: "僅供資訊查詢，不構成投資建議。"
  };
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
  const places = (data.places || []).slice(0, 5).map((place) => ({
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    rating: place.rating || null,
    mapsUrl: place.googleMapsUri || "",
    openNow: place.currentOpeningHours?.openNow
  }));

  return {
    ok: places.length > 0,
    source,
    places,
    message: places.length ? "" : "找不到符合條件的餐廳。"
  };
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
    case "get_stock_quote":
      return "Stock provider";
    default:
      return "Unknown provider";
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

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
