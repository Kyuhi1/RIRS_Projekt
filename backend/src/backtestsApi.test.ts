import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';
import { writeTestParquet } from './testData.ts';

const JAN1 = Date.UTC(2024, 0, 1);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

async function withData(fn: (base: string, pool: Pool) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  try {
    for (const ticker of ['BTCUSDT', 'ETHUSDT']) await writeTestParquet(dir, ticker, 'a.parquet', JAN1, 3 * 1440);
    await withApp(fn, dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

const strategyId = async (pool: Pool, name: string) => Number((await pool.query('SELECT id FROM strategies WHERE name = $1', [name])).rows[0].id);
const post = (base: string, path: string, cookie: string | undefined, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (base: string, path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
const count = async (pool: Pool, table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
const valid = async (pool: Pool, extra: Record<string, unknown> = {}) => ({
  strategy_id: await strategyId(pool, 'Buy & Hold'),
  instruments: ['BTCUSDT'],
  venue_id: 'gross',
  from: '2024-01-01',
  to: '2024-01-03',
  ...extra,
});

test('POST /api/backtests izračuna test in ga shrani v stanju draft z lastnikom, parametri in sredstvi', async () => {
  await withData(async (base, pool) => {
    const email = await addUser(pool, 'trader');
    const cookie = await loginCookie(base, email);
    const sma = await strategyId(pool, 'SMA Crossover');

    const res = await post(base, '/api/backtests', cookie, await valid(pool, { strategy_id: sma, instruments: ['ETHUSDT', 'BTCUSDT'], params: { fast: 5 } }));
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.status, 'draft');
    assert.equal(body.visibility, 'private');
    assert.deepEqual(body.instruments, ['BTCUSDT', 'ETHUSDT']);
    assert.deepEqual(body.params, { fast: 5, slow: 30 });
    assert.deepEqual([body.from, body.to, body.strategy_name, body.venue_id], ['2024-01-01', '2024-01-03', 'SMA Crossover', 'gross']);
    assert.equal(body.results.equityCurve.length, 3);

    const row = (await pool.query('SELECT owner_id, status, params FROM backtests')).rows[0];
    assert.equal(row.owner_id, (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
    assert.deepEqual([row.status, row.params], ['draft', { fast: 5, slow: 30 }]);
    assert.deepEqual((await pool.query('SELECT ticker FROM backtest_instruments ORDER BY ticker')).rows.map((r) => r.ticker), ['BTCUSDT', 'ETHUSDT']);
    // parametri za test ne prepišejo privzetih parametrov strategije
    assert.deepEqual((await pool.query('SELECT default_params FROM strategies WHERE id = $1', [sma])).rows[0].default_params, { fast: 10, slow: 30 });
  });
});

test('rezultat testa se ujema z ročnim izračunom (Buy & Hold: (4419.5 - 100) * 100)', async () => {
  await withData(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader'));
    const body = (await (await post(base, '/api/backtests', cookie, await valid(pool))).json()) as any;
    near(body.results.netProfit, 431_950);
    near(body.results.returnPct, 4319.5);
    assert.equal(body.results.tradeCount, 1);
  });
});

test('neveljaven zahtevek, obdobje zunaj podatkov in napaka strategije ne shranijo testa', async () => {
  await withData(async (base, pool) => {
    const email = await addUser(pool, 'trader');
    const cookie = await loginCookie(base, email);
    const ownerId = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;

    const empty = await post(base, '/api/backtests', cookie, {});
    assert.equal(empty.status, 400);
    assert.deepEqual(Object.keys(((await empty.json()) as any).errors).sort(), ['from', 'instruments', 'strategy_id', 'to', 'venue_id']);

    const outside = await post(base, '/api/backtests', cookie, await valid(pool, { to: '2024-02-01' }));
    assert.equal(outside.status, 400);
    assert.match(((await outside.json()) as any).errors.period, /2024-01-01 do 2024-01-03/);

    const broken = Number(
      (await pool.query("INSERT INTO strategies (owner_id, name, source) VALUES ($1, 'x', 'export default () => { throw new Error(''napaka'') }') RETURNING id", [ownerId])).rows[0].id,
    );
    const failed = await post(base, '/api/backtests', cookie, await valid(pool, { strategy_id: broken }));
    assert.equal(failed.status, 422);
    assert.deepEqual(await failed.json(), { error: 'Strategija je vrnila napako: napaka' });

    assert.equal((await post(base, '/api/backtests', cookie, '{neveljaven json')).status, 400);
    assert.equal(await count(pool, 'backtests'), 0);
    assert.equal(await count(pool, 'backtest_instruments'), 0);
  });
});

test('GET /api/backtests in GET /api/backtests/:id vrneta samo teste lastnika, tuji vrnejo 404', async () => {
  await withData(async (base, pool) => {
    const ana = await loginCookie(base, await addUser(pool, 'trader', 'ana@example.com'));
    const bor = await loginCookie(base, await addUser(pool, 'trader', 'bor@example.com'));
    const first = ((await (await post(base, '/api/backtests', ana, await valid(pool))).json()) as any).id as number;
    const second = ((await (await post(base, '/api/backtests', ana, await valid(pool, { venue_id: 'weex-futures' }))).json()) as any).id as number;
    const tuj = ((await (await post(base, '/api/backtests', bor, await valid(pool))).json()) as any).id as number;

    const list = (await (await get(base, '/api/backtests', ana)).json()) as any[];
    assert.deepEqual(list.map((t) => t.id), [second, first]); // najnovejši prvi, brez Borovega
    assert.deepEqual(Object.keys(list[0].summary).sort(), ['maxDrawdownPct', 'netProfit', 'returnPct', 'tradeCount', 'winRatePct']);
    assert.equal(list[0].results, undefined); // povzetek brez krivulje in poslov
    assert.deepEqual(((await (await get(base, '/api/backtests', bor)).json()) as any[]).map((t) => t.id), [tuj]);

    const own = await get(base, `/api/backtests/${first}`, ana);
    assert.equal(own.status, 200);
    assert.equal(((await own.json()) as any).results.trades.length, 1);

    for (const path of [`/api/backtests/${tuj}`, '/api/backtests/99999', '/api/backtests/abc']) {
      assert.equal((await get(base, path, ana)).status, 404, path);
    }
  });
});

test('testi zahtevajo prijavo vloge trgovec, drugi načini so zavrnjeni', async () => {
  await withData(async (base, pool) => {
    assert.equal((await get(base, '/api/backtests')).status, 401);
    assert.equal((await get(base, '/api/backtests/1')).status, 401);
    assert.equal((await post(base, '/api/backtests', undefined, {})).status, 401);

    for (const role of ['mentor', 'admin']) {
      const cookie = await loginCookie(base, await addUser(pool, role));
      assert.equal((await get(base, '/api/backtests', cookie)).status, 403, role);
      assert.equal((await post(base, '/api/backtests', cookie, await valid(pool))).status, 403, role);
    }
    const trader = await loginCookie(base, await addUser(pool, 'trader'));
    const del = await fetch(`${base}/api/backtests/1`, { method: 'DELETE', headers: { Cookie: trader } });
    assert.equal(del.status, 405);
    assert.equal(await count(pool, 'backtests'), 0);
  });
});
