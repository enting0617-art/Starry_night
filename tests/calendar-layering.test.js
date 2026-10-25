import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('calendar editor modal stays above Schedule-X week and day headers', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const backdrop = css.match(/\.calendar-modal-backdrop\s*\{([^}]+)\}/u)?.[1] || '';
  const editor = css.match(/\.calendar-editor\s*\{([^}]+)\}/u)?.[1] || '';
  const zIndex = Number(backdrop.match(/z-index:\s*(\d+)/u)?.[1] || 0);
  assert.ok(zIndex > 102, 'modal must stay above Schedule-X maximum header popup layer');
  assert.match(backdrop, /isolation:\s*isolate/u);
  assert.match(editor, /position:\s*relative/u);
});
