import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import express from 'express';
import { loadConfig, projectRoot } from '../config.js';

const cachePath = join(projectRoot, 'data', 'search-cache.json');
const userAgent = 'StarryNightBot/0.1 (+https://github.com/enting0617-art/Starry_night)';
const memoryCache = new Map();

function cleanText(value, limit = 8000) {
  return String(value || '').replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cacheKey(kind, input) { return `${kind}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`; }

async function readCache() {
  try { return JSON.parse(await readFile(cachePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function getCached(key) {
  const now = Date.now();
  const item = memoryCache.get(key) || (await readCache())[key];
  if (!item || item.expiresAt <= now) return null;
  memoryCache.set(key, item);
  return item.value;
}

async function setCached(key, value, ttlMs) {
  const item = { expiresAt: Date.now() + ttlMs, value };
  memoryCache.set(key, item);
  const disk = await readCache();
  disk[key] = item;
  for (const [entryKey, entry] of Object.entries(disk)) if (!entry?.expiresAt || entry.expiresAt <= Date.now()) delete disk[entryKey];
  await mkdir(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(disk), 'utf8');
  await rename(temporary, cachePath);
}

function apiError(code, message) { const error = new Error(message); error.code = code; return error; }

export async function assertPublicHttpUrl(input) {
  let url;
  try { url = new URL(String(input)); } catch { throw apiError('INVALID_URL', '网页地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw apiError('INVALID_URL', '仅支持不含账号密码的 HTTP/HTTPS 地址');
  const blockedNames = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);
  if (blockedNames.has(url.hostname.toLowerCase()) || url.hostname.endsWith('.local')) throw apiError('SSRF_BLOCKED', '不允许读取本机或局域网地址');
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); } catch { throw apiError('DNS_FAILED', '无法解析网页域名'); }
  if (!addresses.length || addresses.some(({ address }) => !ipaddr.isValid(address) || !ipaddr.parse(address).range().includes('unicast'))) throw apiError('SSRF_BLOCKED', '目标地址不是可访问的公网地址');
  return url;
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (![429, 502, 503, 504].includes(response.status) || attempt === retries) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt)));
    } catch (error) { lastError = error; if (attempt === retries) throw error; }
  }
  throw lastError || apiError('API_UNAVAILABLE', '服务不可用');
}

export async function webSearch(query, limit = 5) {
  const config = await loadConfig();
  const safeQuery = cleanText(query, 300);
  if (!safeQuery) return [];
  const key = cacheKey('web', { query: safeQuery, limit });
  const cached = await getCached(key);
  if (cached) return cached.map((item) => ({ ...item, cached: true }));
  if (config.webSearch.provider !== 'searxng') throw apiError('SOURCE_DISABLED', 'SearXNG 尚未启用；请在 config.local.json 中启用后使用。');
  const endpoint = new URL('/search', config.webSearch.endpoint);
  endpoint.searchParams.set('q', safeQuery);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('language', 'zh-CN');
  endpoint.searchParams.set('safesearch', '1');
  const response = await fetchWithRetry(endpoint, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(config.webSearch.timeoutMs) });
  if (!response.ok) throw apiError(response.status === 429 ? 'RATE_LIMITED' : 'API_UNAVAILABLE', `SearXNG HTTP ${response.status}`);
  const body = await response.json();
  const results = (body.results || []).slice(0, Math.min(Math.max(Number(limit) || 5, 1), 10)).map((item) => ({ title: cleanText(item.title, 240), url: String(item.url || ''), snippet: cleanText(item.content, 700), source: item.engine || 'searxng', fetchedAt: new Date().toISOString() })).filter((item) => item.url.startsWith('http'));
  await setCached(key, results, config.search.cacheSearchTtlMs);
  return results;
}

export async function wikiSearch(query, limit = 5, language = 'zh') {
  const config = await loadConfig();
  const lang = ['zh', 'en', 'ja'].includes(language) ? language : 'zh';
  const safeQuery = cleanText(query, 160);
  if (!safeQuery) return [];
  const key = cacheKey('wiki', { query: safeQuery, lang, limit });
  const cached = await getCached(key);
  if (cached) return cached.map((item) => ({ ...item, cached: true }));
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  Object.entries({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: safeQuery, gsrlimit: String(Math.min(Math.max(Number(limit) || 5, 1), 10)), prop: 'extracts|info', exintro: '1', explaintext: '1', inprop: 'url', maxlag: '5' }).forEach(([keyName, value]) => url.searchParams.set(keyName, value));
  const response = await fetchWithRetry(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(config.webSearch.timeoutMs) });
  if (!response.ok) throw apiError(response.status === 429 ? 'RATE_LIMITED' : 'API_UNAVAILABLE', `Wikipedia HTTP ${response.status}`);
  const body = await response.json();
  const pages = (body.query?.pages || []).map((page) => ({ title: page.title, url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, snippet: cleanText(page.extract, 1200), source: `wikipedia-${lang}`, license: 'CC BY-SA 4.0', fetchedAt: new Date().toISOString() }));
  await setCached(key, pages, config.search.cacheWikiTtlMs);
  return pages;
}

export function extractText(html, url) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document, { charThreshold: 200, maxElemsToParse: 50000 }).parse();
  const fallback = cleanText(dom.window.document.body?.textContent, 30000);
  return { title: cleanText(article?.title || dom.window.document.title, 300), byline: cleanText(article?.byline, 200), excerpt: cleanText(article?.excerpt, 800), text: cleanText(article?.textContent || fallback, 30000) };
}

export async function readUrl(input) {
  const config = await loadConfig();
  const checked = await assertPublicHttpUrl(input);
  const key = cacheKey('page', checked.href);
  const cached = await getCached(key);
  if (cached) return { ...cached, cached: true };
  const robotsUrl = new URL('/robots.txt', checked);
  try {
    const robotsResponse = await fetch(robotsUrl, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(5000) });
    if (robotsResponse.ok) {
      const robots = robotsParser(robotsUrl.href, await robotsResponse.text());
      if (!robots.isAllowed(checked.href, userAgent)) throw apiError('ROBOTS_DENIED', '该网站 robots.txt 不允许读取此页面');
    }
  } catch (error) { if (error.code === 'ROBOTS_DENIED') throw error; }
  let current = checked;
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetchWithRetry(current, { redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': userAgent }, signal: AbortSignal.timeout(config.webSearch.timeoutMs) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    current = await assertPublicHttpUrl(new URL(response.headers.get('location'), current).href);
  }
  if (!response?.ok) throw apiError(response?.status === 429 ? 'RATE_LIMITED' : 'API_UNAVAILABLE', `网页读取失败：HTTP ${response?.status || 0}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 3_000_000) throw apiError('TOO_LARGE', '网页内容超过 3MB 安全限制');
  const html = await response.text();
  if (html.length > 3_000_000) throw apiError('TOO_LARGE', '网页内容超过 3MB 安全限制');
  const result = { ...extractText(html, current.href), url: current.href, source: new URL(current).hostname, fetchedAt: new Date().toISOString() };
  await setCached(key, result, config.search.cachePageTtlMs);
  return result;
}

export function createSearchRouter() {
  const router = express.Router();
  router.get('/health', async (_request, response) => {
    const config = await loadConfig();
    let searxng = false;
    try { const probe = await fetch(new URL('/search?q=health&format=json', config.webSearch.endpoint), { signal: AbortSignal.timeout(3000) }); searxng = probe.ok; } catch { /* unavailable is reported, not fatal */ }
    response.json({ ok: true, provider: config.webSearch.provider, searxng });
  });
  router.post('/web_search', async (request, response, next) => { try { response.json({ results: await webSearch(request.body?.query, request.body?.limit) }); } catch (error) { next(error); } });
  router.post('/wiki_search', async (request, response, next) => { try { response.json({ results: await wikiSearch(request.body?.query, request.body?.limit, request.body?.language) }); } catch (error) { next(error); } });
  router.post('/read_url', async (request, response, next) => { try { response.json(await readUrl(request.body?.url)); } catch (error) { next(error); } });
  return router;
}
