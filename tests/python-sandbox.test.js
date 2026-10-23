import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPythonSource } from '../server/python-sandbox.js';

test('allows a small pure-computation Python program', () => {
  const result = auditPythonSource({ fileName: 'sum_demo.py', source: 'import math\nprint(math.sqrt(81))' });
  assert.equal(result.ok, true);
});

test('rejects filesystem and process-capable Python code before it is written', () => {
  const result = auditPythonSource({ fileName: 'bad.py', source: "import os\nopen('x.txt', 'w').write('no')" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});
