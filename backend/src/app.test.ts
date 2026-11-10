import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from './app.ts';
import { TEST_SECRET } from './testApp.ts';
import { createCandleStore } from './candles.ts';
import { createPool } from './db.ts';

test('GET /api/health vrne 200 in status ok', async () => {
  const pool = createPool('postgres://localhost/unused'); // health ne uporablja baze, povezava se ne odpre
  const server = createApp(pool, createCandleStore('/ni-podatkov'), TEST_SECRET).listen(0);
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    server.close();
    await pool.end();
  }
});
