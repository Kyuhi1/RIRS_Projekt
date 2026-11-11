import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Candle } from './candles.ts';
import { migrate } from './migrate.ts';
import { simulate } from './simulation.ts';
import { runStrategy } from './strategy.ts';
import { withTestDb } from './testDb.ts';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const HOUR = 3_600_000;
const START = Date.UTC(2024, 0, 1);

// Umetne svečke: trend z valovanjem, da imajo strategije signale.
const BARS: Candle[] = Array.from({ length: 600 }, (_, i) => {
  const close = 100 + 15 * Math.sin(i / 20) + i * 0.02;
  return { time: START + i * HOUR, open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1 };
});

test('sistemske strategije nimajo lastnika, so deljene in se ob ponovnem zagonu ne podvajajo', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const rows = (await pool.query('SELECT owner_id, visibility, name FROM strategies ORDER BY id')).rows;
    assert.deepEqual(rows.map((r) => r.name), ['Nakup in zadrži', 'Presek drsečih povprečij (SMA)', 'Preboj (Donchian)']);
    assert.ok(rows.every((r) => r.owner_id === null && r.visibility === 'shared'));

    assert.deepEqual(await migrate(pool, MIGRATIONS), []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM strategies')).rows[0].n, 3);
  });
});

test('strategija brez lastnika ne more biti zasebna', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    await assert.rejects(pool.query("INSERT INTO strategies (name, source, visibility) VALUES ('x', 'y', 'private')"), /strategies_check|check constraint/);
  });
});

test('vsaka sistemska strategija se izvede v workerju in vrne veljavne posle za simulator', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const strategies = (await pool.query('SELECT name, source, default_params FROM strategies WHERE owner_id IS NULL ORDER BY id')).rows;
    assert.equal(strategies.length, 3);
    for (const { name, source, default_params } of strategies) {
      const trades = await runStrategy(source, BARS, default_params);
      assert.ok(trades.length > 0, `${name} nima poslov`);
      const result = simulate({
        initialCapital: 10_000,
        from: BARS[0]!.time,
        to: BARS.at(-1)!.time + HOUR,
        assets: [{ ticker: 'TEST', trades }],
        venue: { makerPct: 0, takerPct: 0, paySpread: false },
        spreadFor: () => undefined,
      });
      assert.equal(result.tradeCount, trades.length, name);
    }
  });
});

test('Nakup in zadrži: en long posel od prve do zadnje svečke', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const { source } = (await pool.query("SELECT source FROM strategies WHERE name = 'Nakup in zadrži'")).rows[0];
    const trades = await runStrategy(source, BARS, {});
    assert.deepEqual(trades, [
      { side: 'long', entryTime: BARS[0]!.time, exitTime: BARS.at(-1)!.time, entryPrice: BARS[0]!.open, exitPrice: BARS.at(-1)!.close, orderType: 'taker' },
    ]);
  });
});

test('neveljavni parametri dajo razumljivo napako strategije', async () => {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const { source } = (await pool.query("SELECT source FROM strategies WHERE name = 'Presek drsečih povprečij (SMA)'")).rows[0];
    await assert.rejects(runStrategy(source, BARS, { hitro_povprecje: 30, pocasno_povprecje: 10 }), /pocasno_povprecje mora biti večji od hitro_povprecje/);
  });
});
