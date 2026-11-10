import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { createApp } from './app.ts';
import { addUser, loginCookie, TEST_SECRET } from './testApp.ts';
import { createCandleStore } from './candles.ts';
import { migrate } from './migrate.ts';
import { withTestDb } from './testDb.ts';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const EXPECTED = { instruments: 27, venues: 5, prop_plans: 5, spreads: 111 };

async function counts(pool: Pool): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of Object.keys(EXPECTED)) {
    result[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  }
  return result;
}

test('seed naloži referenčne podatke in se ob ponovnem zagonu ne podvaja', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    assert.deepEqual(await counts(pool), EXPECTED);

    assert.deepEqual(await migrate(pool, MIGRATIONS), []);
    assert.deepEqual(await counts(pool), EXPECTED);
  });
});

test('referenčni endpointi vračajo podatke, spreminjanje ni dovoljeno', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const server = createApp(pool, createCandleStore('/ni-podatkov'), TEST_SECRET).listen(0);
    await once(server, 'listening');
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const cookie = await loginCookie(base, await addUser(pool, 'trader'));
      const paths: Record<string, number> = {
        '/api/instruments': EXPECTED.instruments,
        '/api/venues': EXPECTED.venues,
        '/api/prop-plans': EXPECTED.prop_plans,
      };
      for (const [path, expected] of Object.entries(paths)) {
        const res = await fetch(base + path, { headers: { Cookie: cookie } });
        assert.equal(res.status, 200, path);
        assert.equal(((await res.json()) as unknown[]).length, expected, path);

        const post = await fetch(base + path, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(post.status, 405, `POST ${path}`);
      }
    } finally {
      server.close();
    }
  });
});
