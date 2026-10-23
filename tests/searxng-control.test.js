import test from 'node:test';
import assert from 'node:assert/strict';
import { isSearxngSecretConfigured } from '../server/search/searxng-control.js';

test('requires replacing the SearXNG placeholder secret', () => {
  assert.equal(isSearxngSecretConfigured('server:\n  secret_key: "CHANGE_ME_TO_A_RANDOM_SECRET_BEFORE_STARTING"'), false);
  assert.equal(isSearxngSecretConfigured('server:\n  secret_key: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"'), true);
});
