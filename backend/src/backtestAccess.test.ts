import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const send = (base: string, method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as any;

// Mentorja m1 (aktiven učenec t1) in m2 (brez učencev), trgovca t1 in t2 ter administrator.
async function setup(base: string, pool: Pool) {
  const emails = { m1: 'm1@example.com', m2: 'm2@example.com', t1: 't1@example.com', t2: 't2@example.com', admin: 'admin@example.com' };
  for (const [key, email] of Object.entries(emails)) await addUser(pool, key.startsWith('m') ? 'mentor' : key === 'admin' ? 'admin' : 'trader', email);
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  const id = { m1: await idOf(emails.m1), m2: await idOf(emails.m2), t1: await idOf(emails.t1), t2: await idOf(emails.t2) };
  const cookie = {
    m1: await loginCookie(base, emails.m1),
    m2: await loginCookie(base, emails.m2),
    t1: await loginCookie(base, emails.t1),
    t2: await loginCookie(base, emails.t2),
    admin: await loginCookie(base, emails.admin),
  };
  await pool.query("INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, 'active')", [id.m1, id.t1]);
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  // Test s tremi posli v danem stanju; mentor je nastavljen povsod razen pri osnutku.
  const make = async (owner: number, status: string, reviewer: number | null = id.m1) =>
    Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, status, reviewer_id)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{"fast": 5}',
               '{"netProfit": 12.5, "trades": [{"entryTime": 1, "pnl": 1}, {"entryTime": 2, "pnl": 2}, {"entryTime": 3, "pnl": 3}]}', $3, $4) RETURNING id`,
      [owner, strategy, status, status === 'draft' ? null : reviewer])).rows[0].id);
  return { cookie, id, make };
}

test('mentor vidi oddane teste aktivnega učenca samo za branje, z rezultati, parametri in imenom učenca', async () => {
  await withApp(async (base, pool) => {
    const { cookie, id, make } = await setup(base, pool);
    for (const status of ['submitted', 'in_review', 'changes_requested', 'approved']) {
      const test = await make(id.t1, status);
      const res = await send(base, 'GET', `/api/backtests/${test}`, cookie.m1);
      assert.equal(res.status, 200, status);
      const body = await json(res);
      assert.deepEqual([body.status, body.owner, body.params, body.results.netProfit], [status, { id: id.t1, name: 'Test trader' }, { fast: 5 }, 12.5], status);
      assert.equal(body.results.trades, undefined);
      const trades = await json(await send(base, 'GET', `/api/backtests/${test}/trades`, cookie.m1));
      assert.equal(trades.total, 3, status);
    }
  });
});

test('mentor ne vidi osnutkov, umaknjenih testov, testov drugih trgovcev in testov, oddanih drugemu mentorju (404)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, id, make } = await setup(base, pool);
    const hidden = {
      osnutek: await make(id.t1, 'draft'),
      umaknjen: await make(id.t1, 'withdrawn'),
      'tuj trgovec': await make(id.t2, 'submitted'),
      'drug mentor': await make(id.t1, 'submitted', id.m2),
    };
    for (const [name, test] of Object.entries(hidden)) {
      assert.equal((await send(base, 'GET', `/api/backtests/${test}`, cookie.m1)).status, 404, name);
      assert.equal((await send(base, 'GET', `/api/backtests/${test}/trades`, cookie.m1)).status, 404, name);
    }
    // mentor brez aktivne povezave z lastnikom testa ga ne vidi
    const mine = await make(id.t1, 'submitted');
    assert.equal((await send(base, 'GET', `/api/backtests/${mine}`, cookie.m2)).status, 404);
    assert.equal((await send(base, 'GET', '/api/backtests/999999', cookie.m1)).status, 404);
    assert.equal((await send(base, 'GET', '/api/backtests/abc', cookie.m1)).status, 404);
  });
});

test('po prekinitvi povezave mentor testov učenca ne vidi več, trgovec pa jih še vedno vidi', async () => {
  await withApp(async (base, pool) => {
    const { cookie, id, make } = await setup(base, pool);
    const test = await make(id.t1, 'in_review');
    assert.equal((await send(base, 'GET', `/api/backtests/${test}`, cookie.m1)).status, 200);
    assert.equal((await send(base, 'POST', `/api/mentor-links/${(await pool.query('SELECT id FROM mentor_links')).rows[0].id}/end`, cookie.m1)).status, 200);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}`, cookie.m1)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}/trades`, cookie.m1)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}`, cookie.t1)).status, 200);
  });
});

test('spremembe params in results vrnejo 403 (vidni test) ali 404 (nevidni), podatki ostanejo nespremenjeni', async () => {
  await withApp(async (base, pool) => {
    const { cookie, id, make } = await setup(base, pool);
    const visible = await make(id.t1, 'submitted');
    const draft = await make(id.t1, 'draft');
    const before = (await pool.query('SELECT params, results FROM backtests ORDER BY id')).rows;
    const change = { params: { fast: 99 }, results: { netProfit: 1e6 } };
    for (const method of ['PATCH', 'PUT']) {
      const res = await send(base, method, `/api/backtests/${visible}`, cookie.m1, change);
      assert.equal(res.status, 403, method);
      assert.match((await json(res)).error, /ni mogoče spreminjati/);
      assert.equal((await send(base, method, `/api/backtests/${draft}`, cookie.m1, change)).status, 404, method); // nevidni test
      assert.equal((await send(base, method, `/api/backtests/${visible}`, cookie.m2, change)).status, 404, method); // tuj mentor
      assert.equal((await send(base, method, `/api/backtests/${visible}`, cookie.t1, change)).status, 403, method); // tudi lastnik: izvedeni test je nespremenljiv
      assert.equal((await send(base, method, `/api/backtests/${visible}`, cookie.t2, change)).status, 404, method);
      assert.equal((await send(base, method, `/api/backtests/${visible}`, cookie.admin, change)).status, 403, method);
      assert.equal((await send(base, method, `/api/backtests/${visible}`, undefined, change)).status, 401, method);
    }
    assert.deepEqual((await pool.query('SELECT params, results FROM backtests ORDER BY id')).rows, before);
  });
});

test('mentor ne more ustvarjati, oddajati ali umikati testov, seznama testov trgovca pa ne dobi; administrator nima dostopa', async () => {
  await withApp(async (base, pool) => {
    const { cookie, id, make } = await setup(base, pool);
    const test = await make(id.t1, 'draft');
    assert.equal((await send(base, 'GET', '/api/backtests', cookie.m1)).status, 403);
    assert.equal((await send(base, 'POST', '/api/backtests', cookie.m1, {})).status, 403);
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/submit`, cookie.m1)).status, 403);
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/withdraw`, cookie.m1)).status, 403);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}`, cookie.admin)).status, 403);
    assert.equal((await send(base, 'DELETE', `/api/backtests/${test}`, cookie.t1)).status, 405);
    // trgovec še vedno vidi svoje osnutke
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${test}`, cookie.t1))).status, 'draft');
  });
});
