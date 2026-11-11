import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';
import { writeTestParquet } from './testData.ts';

const JAN1 = Date.UTC(2024, 0, 1);
const send = (base: string, method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as any;
const count = async (pool: Pool) => Number((await pool.query('SELECT count(*) FROM backtests')).rows[0].count);

async function withData(fn: (base: string, pool: Pool) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  try {
    for (const ticker of ['BTCUSDT', 'ETHUSDT']) await writeTestParquet(dir, ticker, 'a.parquet', JAN1, 3 * 1440);
    await withApp(fn, dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

// Trgovec t1 z mentorjem m1, drug trgovec t2, administrator. Prvotni test je pravi (izračunan prek API).
async function setup(base: string, pool: Pool) {
  await addUser(pool, 'mentor', 'm1@example.com');
  await addUser(pool, 'trader', 't1@example.com');
  await addUser(pool, 'trader', 't2@example.com');
  await addUser(pool, 'admin', 'admin@example.com');
  const cookie = {
    m1: await loginCookie(base, 'm1@example.com'), t1: await loginCookie(base, 't1@example.com'),
    t2: await loginCookie(base, 't2@example.com'), admin: await loginCookie(base, 'admin@example.com'),
  };
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  await pool.query("INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, 'active')", [await idOf('m1@example.com'), await idOf('t1@example.com')]);
  const sma = Number((await pool.query("SELECT id FROM strategies WHERE name = 'SMA Crossover'")).rows[0].id);
  const create = async (extra: Record<string, unknown> = {}) =>
    json(await send(base, 'POST', '/api/backtests', cookie.t1, {
      strategy_id: sma, instruments: ['ETHUSDT', 'BTCUSDT'], venue_id: 'gross', from: '2024-01-01', to: '2024-01-03', params: { fast: 5 }, ...extra,
    }));
  const setStatus = async (testId: number, status: string) => {
    await pool.query('UPDATE backtests SET status = $2, reviewer_id = $3 WHERE id = $1', [testId, status, status === 'draft' ? null : await idOf('m1@example.com')]);
  };
  return { cookie, create, setStatus, sma };
}

test('ponovitev: nov osnutek z istimi nastavitvami in previous_id, prvotni test dobi next_id in ostane nespremenjen', async () => {
  await withData(async (base, pool) => {
    const { cookie, create, setStatus, sma } = await setup(base, pool);
    const original = await create({ prop_plan_id: 'topstep-50k' });
    await setStatus(original.id, 'changes_requested');
    const res = await send(base, 'POST', `/api/backtests/${original.id}/retest`, cookie.t1);
    assert.equal(res.status, 201);
    const again = await json(res);
    assert.notEqual(again.id, original.id);
    assert.deepEqual([again.status, again.previous_id, again.next_id, again.reviewer, again.history], ['draft', original.id, null, null, []]);
    assert.deepEqual(
      [again.strategy_id, again.params, again.instruments, again.venue_id, again.from, again.to, again.prop_plan.id, again.visibility],
      [sma, { fast: 5, slow: 30 }, ['BTCUSDT', 'ETHUSDT'], 'gross', '2024-01-01', '2024-01-03', 'topstep-50k', 'private'],
    );
    assert.equal(again.results.initialCapital, 50000); // načrt financiranega računa velja tudi pri ponovitvi
    assert.equal(again.results.netProfit, original.results.netProfit); // enaki podatki in nastavitve dajo enak rezultat
    const old = await json(await send(base, 'GET', `/api/backtests/${original.id}`, cookie.t1));
    assert.deepEqual([old.status, old.next_id, old.previous_id], ['changes_requested', again.id, null]);
    const list = await json(await send(base, 'GET', '/api/backtests', cookie.t1));
    assert.deepEqual(list.map((t: any) => [t.id, t.previous_id, t.next_id]), [[again.id, original.id, null], [original.id, null, again.id]]);
    assert.equal(await count(pool), 2);
  });
});

test('ponovitev je mogoča samo pri changes_requested (409), nov osnutek je navaden test, ki ga je mogoče oddati', async () => {
  await withData(async (base, pool) => {
    const { cookie, create, setStatus } = await setup(base, pool);
    for (const status of ['draft', 'submitted', 'in_review', 'approved', 'withdrawn']) {
      const t = await create();
      await setStatus(t.id, status);
      const res = await send(base, 'POST', `/api/backtests/${t.id}/retest`, cookie.t1);
      assert.equal(res.status, 409, status);
      assert.match((await json(res)).error, /zahteval spremembe/);
    }
    const before = await count(pool);
    const original = await create();
    await setStatus(original.id, 'changes_requested');
    const again = await json(await send(base, 'POST', `/api/backtests/${original.id}/retest`, cookie.t1));
    assert.equal(await count(pool), before + 2);
    // ponovitev je osnutek: ponoviti je ni mogoče, oddati pa
    assert.equal((await send(base, 'POST', `/api/backtests/${again.id}/retest`, cookie.t1)).status, 409);
    const submitted = await send(base, 'POST', `/api/backtests/${again.id}/submit`, cookie.t1);
    assert.equal(submitted.status, 200);
    assert.equal((await json(submitted)).status, 'submitted');
  });
});

test('iz testa nastane največ ena ponovitev, tudi pri sočasnih zahtevkih', async () => {
  await withData(async (base, pool) => {
    const { cookie, create, setStatus } = await setup(base, pool);
    const original = await create();
    await setStatus(original.id, 'changes_requested');
    const results = await Promise.all([1, 2, 3].map(() => send(base, 'POST', `/api/backtests/${original.id}/retest`, cookie.t1)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await count(pool), 2);
    const duplicate = await send(base, 'POST', `/api/backtests/${original.id}/retest`, cookie.t1);
    assert.equal(duplicate.status, 409);
    assert.match((await json(duplicate)).error, /že bil ponovljen/);
    assert.equal(await count(pool), 2);
  });
});

test('ponovitev drugega trgovca ali neobstoječega testa je 404, mentor in administrator nimata dostopa', async () => {
  await withData(async (base, pool) => {
    const { cookie, create, setStatus } = await setup(base, pool);
    const original = await create();
    await setStatus(original.id, 'changes_requested');
    const retest = (id: number | string, who?: string, method = 'POST') => send(base, method, `/api/backtests/${id}/retest`, who ? cookie[who as keyof typeof cookie] : undefined);
    assert.equal((await retest(original.id, 't2')).status, 404);
    assert.equal((await retest(999999, 't1')).status, 404);
    assert.equal((await retest('abc', 't1')).status, 404);
    assert.equal((await retest(original.id, 'm1')).status, 403);
    assert.equal((await retest(original.id, 'admin')).status, 403);
    assert.equal((await retest(original.id)).status, 401);
    assert.equal((await retest(original.id, 't1', 'GET')).status, 405);
    assert.equal(await count(pool), 1);
  });
});

test('ponovitev, ki je ni mogoče izračunati, ne ustvari testa in ne zaklene prvotnega', async () => {
  await withApp(async (base, pool) => {
    const { cookie, setStatus, sma } = await setup(base, pool);
    // Prvotni test brez podatkov na disku (privzeta mapa ne obstaja), zato ponovni izračun ne uspe.
    const row = await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, status)
       VALUES ((SELECT id FROM users WHERE email = 't1@example.com'), $1, 'gross', '2024-01-01', '2024-01-03', '{"fast": 5, "slow": 30}', '{"trades": []}', 'draft') RETURNING id`, [sma]);
    const id = Number(row.rows[0].id);
    await pool.query("INSERT INTO backtest_instruments (backtest_id, ticker) VALUES ($1, 'BTCUSDT')", [id]);
    await setStatus(id, 'changes_requested');
    const res = await send(base, 'POST', `/api/backtests/${id}/retest`, cookie.t1);
    assert.ok(res.status >= 400 && res.status < 500, String(res.status));
    assert.equal(await count(pool), 1);
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.t1))).next_id, null);
  });
});
