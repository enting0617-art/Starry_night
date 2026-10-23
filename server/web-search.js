import { loadConfig } from './config.js';

function decodeHtml(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return entities[entity.toLowerCase()] || `&${entity};`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResultUrl(value) {
  const decoded = decodeHtml(value);
  try {
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://duckduckgo.com');
    if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.get('uddg')) return decodeURIComponent(url.searchParams.get('uddg'));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export async function searchWeb(query) {
  const config = await loadConfig();
  if (!config.webSearch.enabled) throw new Error('配置已关闭网络搜索。');
  const safeQuery = String(query || '').trim().slice(0, 500);
  if (!safeQuery) return [];
  if (/(天气|气温|温度|预报|weather|forecast)/iu.test(safeQuery)) {
    const weather = await fetchWeather(safeQuery, config.webSearch.timeoutMs);
    if (weather.length) return weather;
  }
  const url = new URL(config.webSearch.endpoint);
  url.searchParams.set('q', safeQuery);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XingkongLocalAI/0.8; +local-search)' },
    signal: AbortSignal.timeout(config.webSearch.timeoutMs),
  });
  if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
  const html = await response.text();
  const blocks = html.split(/class=["']result(?:\s+results_[^"']*)?["']/iu).slice(1);
  const results = [];
  for (const block of blocks) {
    const titleMatch = block.match(/class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/iu)
      || block.match(/href=["']([^"']+)["'][^>]*class=["']result__a["'][^>]*>([\s\S]*?)<\/a>/iu);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/(?:a|div)>/iu);
    const resultUrl = normalizeResultUrl(titleMatch[1]);
    if (!resultUrl) continue;
    results.push({ title: decodeHtml(titleMatch[2]).slice(0, 240), url: resultUrl, snippet: decodeHtml(snippetMatch?.[1]).slice(0, 600) });
    if (results.length >= config.webSearch.maxResults) break;
  }
  return results;
}

async function fetchWeather(query, timeoutMs) {
  const cityHint = String(query).replace(/(?:今天|今日|明天|天气|气温|温度|预报|怎么样|查询一下|查一下|请|帮我|weather|forecast)/giu, ' ').replace(/[，。？！?]/gu, ' ').trim();
  const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodeUrl.searchParams.set('name', cityHint || query);
  geocodeUrl.searchParams.set('count', '1');
  geocodeUrl.searchParams.set('language', 'zh');
  geocodeUrl.searchParams.set('format', 'json');
  const geocodeResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!geocodeResponse.ok) return [];
  const location = (await geocodeResponse.json()).results?.[0];
  if (!location?.latitude || !location?.longitude) return [];
  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(location.latitude));
  forecastUrl.searchParams.set('longitude', String(location.longitude));
  forecastUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
  forecastUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');
  forecastUrl.searchParams.set('forecast_days', '2');
  forecastUrl.searchParams.set('timezone', 'auto');
  const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!forecastResponse.ok) return [];
  const forecast = await forecastResponse.json();
  const current = forecast.current || {};
  const daily = forecast.daily || {};
  const weatherName = weatherCodeName(current.weather_code);
  const date = daily.time?.[0] || current.time || '';
  const high = daily.temperature_2m_max?.[0];
  const low = daily.temperature_2m_min?.[0];
  const snippet = `${location.name}${location.country ? `（${location.country}）` : ''} ${date}：${weatherName}，当前 ${current.temperature_2m ?? '未知'}°C，今日 ${low ?? '未知'}–${high ?? '未知'}°C，湿度 ${current.relative_humidity_2m ?? '未知'}%，风速 ${current.wind_speed_10m ?? '未知'} km/h。`;
  return [{ title: `${location.name}天气（Open-Meteo）`, snippet, url: 'https://open-meteo.com/' }];
}

function weatherCodeName(code) {
  const names = { 0: '晴', 1: '基本晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '中阵雨', 82: '强阵雨', 95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹' };
  return names[code] || '天气状况未知';
}

const clockPattern = /(?:现在|当前|此刻|当地|本地).{0,6}(?:几点|时间|日期|几号|星期几)|(?:几点|what\s+time|current\s+(?:time|date)|today'?s\s+date)/iu;
const explicitSearchPattern = /(?:搜索|搜一下|查一下|查查|联网查|上网查|网上找|检索|look\s*up|search\s+(?:for|the\s+web)|browse\s+(?:for|the\s+web))/iu;
const freshnessPattern = /(?:最新|最近|今天|今日|昨天|明天|本周|本月|今年|目前|当前|现在|刚刚|实时|新闻|天气|气温|预报|价格|售价|汇率|股价|币价|比分|赛程|票房|排名|榜单|任职|现任|总统|总理|首相|CEO|版本|更新|发布|政策|法规|法律|规定|开放时间|营业时间|航班|火车|库存|利率|通胀|latest|recent|today|yesterday|tomorrow|current|currently|now|news|weather|forecast|price|exchange\s+rate|stock|score|schedule|version|release|president|prime\s+minister|CEO|law|regulation)/iu;

export function planWebSearch(query, enabled) {
  const text = String(query || '').trim();
  if (!enabled) return { shouldSearch: false, reason: 'disabled', needsClock: clockPattern.test(text) };
  const needsClock = clockPattern.test(text);
  if (needsClock && !explicitSearchPattern.test(text)) return { shouldSearch: false, reason: 'local-clock', needsClock: true };
  if (explicitSearchPattern.test(text)) return { shouldSearch: true, reason: 'explicit', needsClock };
  if (freshnessPattern.test(text)) return { shouldSearch: true, reason: 'fresh-information', needsClock };
  return { shouldSearch: false, reason: 'stable-information', needsClock };
}
