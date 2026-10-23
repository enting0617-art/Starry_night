import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, extractText } from '../server/search/search-tools.js';

test('extracts article text instead of navigation content', () => {
  const result = extractText('<html><head><title>测试页面</title></head><body><nav>菜单 首页 设置</nav><article><h1>标题</h1><p>这是正文第一段，包含足够内容用于测试正文提取。</p><p>这是正文第二段，继续说明文章内容。</p></article></body></html>', 'https://example.com/article');
  assert.match(result.text, /正文第一段/);
  assert.equal(result.title, '测试页面');
});

test('blocks localhost and private targets', async () => {
  await assert.rejects(() => assertPublicHttpUrl('http://localhost:11434/api/tags'), { code: 'SSRF_BLOCKED' });
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/'), { code: 'SSRF_BLOCKED' });
});
