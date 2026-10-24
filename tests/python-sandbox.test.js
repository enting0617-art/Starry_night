import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPythonSource, getPythonSandboxStatus, runPythonInSandbox } from '../server/python-sandbox.js';

test('allows a small pure-computation Python program', () => {
  const result = auditPythonSource({ fileName: 'sum_demo.py', source: 'import math\nprint(math.sqrt(81))' });
  assert.equal(result.ok, true);
});

test('rejects filesystem and process-capable Python code before it is written', () => {
  const result = auditPythonSource({ fileName: 'bad.py', source: "import os\nopen('x.txt', 'w').write('no')" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('runs pure computation through the native Windows sandbox', async (t) => {
  const status = await getPythonSandboxStatus();
  assert.equal(status.backend, 'windows-appcontainer-job');
  if (!status.canRun) {
    t.skip('native helper or bundled runtime is not present in this checkout');
    return;
  }
  const result = await runPythonInSandbox({ fileName: 'native_math.py', source: 'print(20 + 22)' });
  assert.equal(result.ran, true, JSON.stringify(result));
  assert.equal(result.backend, 'appcontainer-job');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '42');
});
