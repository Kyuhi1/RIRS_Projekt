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

// Trgovca a (z mentorjem m) in b, mentor m, drug mentor m2 in administrator.
async function setup(base: string, pool: Pool) {
  for (const [role, email] of [['trader', 'a@example.com'], ['trader', 'b@example.com'], ['mentor', 'm@example.com'], ['mentor', 'm2@example.com'], ['admin', 'admin@example.com']]) await addUser(pool, role!, email!);
  const cookie = {
    a: await loginCookie(base, 'a@example.com'), b: await loginCookie(base, 'b@example.com'), m: await loginCookie(base, 'm@example.com'),
    m2: await loginCookie(base, 'm2@example.com'), admin: await loginCookie(base, 'admin@example.com'),
  };
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  await pool.query("INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, 'active')", [await idOf('m@example.com'), await idOf('a@example.com')]);
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  const make = async (owner: string, status = 'draft', visibility = 'private') =>
    Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, status, reviewer_id, visibility)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{"fast": 5}', '{"netProfit": 7, "trades": [{"entryTime": 1}, {"entryTime": 2}]}', $3, $4, $5) RETURNING id`,
      [await idOf(owner), strategy, status, status === 'draft' ? null : await idOf('m@example.com'), visibility])).rows[0].id);
  const share = (who: 'a' | 'b', id: number, visibility: string) => send(base, 'PUT', `/api/backtests/${id}/visibility`, cookie[who], { visibility });
  return { cookie, make, share, idOf };
}

test('nov test je privzeto zaseben in ga drugi trgovec ne vidi (404, tudi posli in seznam)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const id = await make('a@example.com');
    assert.equal((await pool.query('SELECT visibility FROM backtests WHERE id = $1', [id])).rows[0].visibility, 'private');
    assert.equal((await send(base, 'GET', `/api/backtests/${id}`, cookie.b)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}/trades`, cookie.b)).status, 404);
    assert.deepEqual(await json(await send(base, 'GET', '/api/backtests?scope=shared', cookie.b)), []);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}`, cookie.a)).status, 200);
  });
});

test('lastnik deli test: drugi trgovec ga vidi samo za branje, v seznamu deljenih, brez podrobnosti oddaje', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, share, idOf } = await setup(base, pool);
    const id = await make('a@example.com', 'in_review');
    await pool.query("INSERT INTO status_history (backtest_id, from_status, to_status, changed_by) VALUES ($1, 'draft', 'submitted', $2)", [id, await idOf('a@example.com')]);
    const res = await share('a', id, 'shared');
    assert.equal(res.status, 200);
    assert.equal((await json(res)).visibility, 'shared');

    const seen = await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.b));
    assert.deepEqual([seen.visibility, seen.owner.name, seen.params, seen.results.netProfit, seen.status], ['shared', 'Test trader', { fast: 5 }, 7, 'in_review']);
    assert.deepEqual([seen.reviewer, seen.history, seen.previous_id, seen.next_id], [null, [], null, null]); // mentor in zgodovina sta zasebna
    const own = await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.a));
    assert.deepEqual([own.reviewer.name, own.history.length], ['Test mentor', 1]); // lastnik vidi vse
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${id}/trades`, cookie.b))).total, 2);

    const list = await json(await send(base, 'GET', '/api/backtests?scope=shared', cookie.b));
    assert.deepEqual(list.map((t: any) => [t.id, t.owner.name, t.visibility, t.summary.netProfit, t.reviewer]), [[id, 'Test trader', 'shared', 7, null]]);
    assert.deepEqual(await json(await send(base, 'GET', '/api/backtests?scope=shared', cookie.a)), []); // lastni testi niso med tujimi
    assert.deepEqual((await json(await send(base, 'GET', '/api/backtests', cookie.b))).map((t: any) => t.id), []); // moji zagoni ostanejo moji
    assert.deepEqual((await json(await send(base, 'GET', '/api/backtests?scope=mine', cookie.a))).map((t: any) => t.id), [id]);
  });
});

test('deljeni test drugi ne more spreminjati ali z njim ukrepati: 403 pri spremembah, 404 pri dejanjih lastnika', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, share } = await setup(base, pool);
    const id = await make('a@example.com', 'changes_requested', 'shared');
    const before = (await pool.query('SELECT params, results, status FROM backtests WHERE id = $1', [id])).rows;
    for (const method of ['PATCH', 'PUT']) assert.equal((await send(base, method, `/api/backtests/${id}`, cookie.b, { params: {} })).status, 403, method);
    for (const action of ['submit', 'withdraw', 'retest']) assert.equal((await send(base, 'POST', `/api/backtests/${id}/${action}`, cookie.b)).status, 404, action);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}/comments`, cookie.b)).status, 404); // mentorjevi komentarji so zasebni
    assert.equal((await share('b', id, 'private')).status, 403); // vidnosti ne more spremeniti
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/start-review`, cookie.m)).status, 409); // mentor testa še vedno vidi
    assert.deepEqual((await pool.query('SELECT params, results, status FROM backtests WHERE id = $1', [id])).rows, before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM backtests')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM status_history')).rows[0].n, 0);
  });
});

test('ob vrnitvi na private test takoj izgine iz seznamov in dostopa drugih', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, share } = await setup(base, pool);
    const id = await make('a@example.com', 'draft', 'shared');
    const other = await make('a@example.com', 'draft', 'shared');
    assert.deepEqual((await json(await send(base, 'GET', '/api/backtests?scope=shared', cookie.b))).map((t: any) => t.id), [other, id]);
    assert.equal((await json(await share('a', id, 'private'))).visibility, 'private');
    assert.deepEqual((await json(await send(base, 'GET', '/api/backtests?scope=shared', cookie.b))).map((t: any) => t.id), [other]);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}`, cookie.b)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}/trades`, cookie.b)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${id}`, cookie.a)).status, 200);
  });
});

test('preklop vidnosti testa: samo lastnik, neveljavna vrednost 400, mentor in administrator 403, brez prijave 401', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, share } = await setup(base, pool);
    const id = await make('a@example.com');
    const put = (who: string | undefined, target: number | string, body: unknown = { visibility: 'shared' }) =>
      send(base, 'PUT', `/api/backtests/${target}/visibility`, who ? cookie[who as keyof typeof cookie] : undefined, body);
    assert.equal((await put('b', id)).status, 404); // tuj zasebni test
    assert.equal((await put('a', 999999)).status, 404);
    assert.equal((await put('a', 'abc')).status, 404);
    for (const who of ['m', 'admin']) assert.equal((await put(who, id)).status, 403, who);
    assert.equal((await put(undefined, id)).status, 401);
    for (const body of [{}, { visibility: 'public' }, { visibility: 1 }, null]) {
      const res = await put('a', id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok((await json(res)).errors.visibility);
    }
    assert.equal((await send(base, 'GET', `/api/backtests/${id}/visibility`, cookie.a)).status, 405);
    assert.equal((await pool.query('SELECT visibility FROM backtests WHERE id = $1', [id])).rows[0].visibility, 'private');
    assert.equal((await share('a', id, 'shared')).status, 200);
    assert.equal((await share('a', id, 'shared')).status, 200); // idempotentno
  });
});

test('mentorji in administrator deljenih testov ne vidijo prek seznama, mentor pa po običajnih pravilih; neveljaven obseg je 400', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const submitted = await make('a@example.com', 'submitted', 'shared');
    const stranger = await make('b@example.com', 'submitted', 'shared'); // učenec drugega mentorja
    for (const who of ['m', 'admin'] as const) assert.equal((await send(base, 'GET', '/api/backtests?scope=shared', cookie[who])).status, 403, who);
    assert.equal((await send(base, 'GET', `/api/backtests/${submitted}`, cookie.m)).status, 200); // njegov aktivni učenec
    assert.equal((await send(base, 'GET', `/api/backtests/${stranger}`, cookie.m)).status, 404); // deljenje mentorju ne odpre tujih učencev
    assert.equal((await send(base, 'GET', `/api/backtests/${submitted}`, cookie.m2)).status, 404);
    assert.equal((await send(base, 'GET', `/api/backtests/${submitted}`, cookie.admin)).status, 403);
    const bad = await send(base, 'GET', '/api/backtests?scope=vse', cookie.a);
    assert.equal(bad.status, 400);
    assert.ok((await json(bad)).errors.scope);
  });
});
