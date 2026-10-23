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
