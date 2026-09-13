import assert from 'node:assert/strict';
import { test } from 'node:test';

import { app } from './app.js';
import { GetUser } from './get-user.endpoint.js';

import { bind } from '@nestlingjs/app';
import { buildTest, unwrap, vars } from '@nestlingjs/testing';

/**
 * The same build under the runner built into Node. Nothing about the
 * framework changes: only the names of the test function and of the
 * assertion, and `--conditions=testing` on the command line instead of a
 * field in a config.
 */
test('calls an endpoint through the whole pipeline, without a socket', async () => {
  await using testApp = await buildTest(app, {
    config: [bind(vars({ API_TOKEN: 'test-token' }))],
  });

  assert.deepEqual(unwrap(await testApp.call(GetUser, { id: '1' })), {
    id: '1',
    name: 'Alice',
    email: 'a@example.com',
  });
});
