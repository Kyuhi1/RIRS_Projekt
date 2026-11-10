import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createApp } from './app.ts';
import { createCandleStore } from './candles.ts';
import { migrate } from './migrate.ts';
import { writeTestParquet } from './testData.ts';
import { withTestDb } from './testDb.ts';

const MIN = 60_000;
const JAN = Date.UTC(2024, 0, 1);
const FEB = Date.UTC(2024, 1, 1);

// Testna količina podatkov: BTCUSDT ima dva dni (po 1440 svečk) v dveh datotekah.
async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  try {
    await writeTestParquet(dir, 'BTCUSDT', '2024-01.parquet', JAN, 1440);
    await writeTestParquet(dir, 'BTCUSDT', '2024-02.parquet', FEB, 1440);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

test('range vrne celoten razpon in število svečk', async () => {
  await withDataDir(async (dir) => {
    const range = await createCandleStore(dir).range('BTCUSDT');
    assert.deepEqual(range, {
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T23:59:00.000Z',
      candles: 2880,
    });
  });
});

test('candles vrne svečke samo za podano obdobje, urejene po času', async () => {
  await withDataDir(async (dir) => {
    const store = createCandleStore(dir);

    const bars = await store.candles('BTCUSDT', JAN + 10 * MIN, JAN + 20 * MIN);
    assert.equal(bars.length, 10);
    assert.deepEqual(bars[0], { time: JAN + 10 * MIN, open: 110, high: 111, low: 109, close: 110.5, volume: 1 });
    assert.equal(bars[9].time, JAN + 19 * MIN);

    // obdobje čez dve datoteki: zadnjih 10 svečk prvega dne in prvih 10 drugega
    const both = await store.candles('BTCUSDT', JAN + 1430 * MIN, FEB + 10 * MIN);
    assert.equal(both.length, 20);
    assert.ok(both.every((b, i) => i === 0 || b.time > both[i - 1].time));
  });
});

test('brez podatkov so rezultati prazni, neveljaven ticker je zavrnjen', async () => {
  const store = createCandleStore('/mapa-ne-obstaja');
  assert.equal(await store.range('BTCUSDT'), null);
  assert.deepEqual(await store.candles('BTCUSDT', 0, Date.now()), []);
  await assert.rejects(store.range('../etc'), /Neveljaven ticker/);
});

test('GET /api/instruments vrne razpon podatkov; brez podatkov aplikacija deluje', async () => {
  const migrations = fileURLToPath(new URL('../db/migrations', import.meta.url));
  await withTestDb(async (pool) => {
    await migrate(pool, migrations);
    await withDataDir(async (dir) => {
      for (const [dataDir, expected] of [[dir, 2880], ['/mapa-ne-obstaja', 0]] as const) {
        const server = createApp(pool, createCandleStore(dataDir)).listen(0);
        await once(server, 'listening');
        try {
          const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/instruments`);
          assert.equal(res.status, 200);
          const list = (await res.json()) as { ticker: string; candles: number; data_from: string | null; data_to: string | null }[];
          assert.equal(list.length, 27);
          const btc = list.find((i) => i.ticker === 'BTCUSDT')!;
          assert.equal(btc.candles, expected);
          assert.equal(btc.data_from, expected ? '2024-01-01T00:00:00.000Z' : null);
          assert.equal(btc.data_to, expected ? '2024-02-01T23:59:00.000Z' : null);
          assert.equal(list.find((i) => i.ticker === 'EURUSD')!.candles, 0);
        } finally {
          server.close();
        }
      }
    });
  });
});
