import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const send = (base: string, method: string, path: string, cookie?: string) => fetch(base + path, { method, headers: cookie ? { Cookie: cookie } : {} });
const json = async (res: Response) => (await res.json()) as any;

// Mentorja m1 (aktivna učenca t1 in t3, povabljen t4, prekinjena povezava t5) in m2 (učenec t2).
async function setup(base: string, pool: Pool) {
  const users: Record<string, [string, string]> = {
    m1: ['mentor', 'm1@example.com'], m2: ['mentor', 'm2@example.com'],
    t1: ['trader', 't1@example.com'], t2: ['trader', 't2@example.com'], t3: ['trader', 't3@example.com'],
    t4: ['trader', 't4@example.com'], t5: ['trader', 't5@example.com'],
  };
  const id: Record<string, number> = {};
  const cookie: Record<string, string> = {};
  for (const [key, [role, email]] of Object.entries(users)) {
    await addUser(pool, role, email);
    id[key] = Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
    cookie[key] = await loginCookie(base, email);
  }
  await pool.query("UPDATE users SET name = 'Ana' WHERE id = $1", [id.t1]);
  await pool.query("UPDATE users SET name = 'Boris' WHERE id = $1", [id.t3]);
  const link = (m: string, t: string, status: string) => pool.query('INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, $3)', [id[m], id[t], status]);
  await link('m1', 't1', 'active');
  await link('m1', 't3', 'active');
  await link('m1', 't4', 'invited');
  await link('m1', 't5', 'ended');
  await link('m2', 't2', 'active');
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  // minute: zamik časa oddaje (višja vrednost = kasneje)
  const make = async (owner: string, status: string, reviewer = 'm1', minute = 0) => {
    const row = await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results, status, reviewer_id)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{"trades": []}', $3, $4) RETURNING id`,
      [id[owner], strategy, status, status === 'draft' ? null : id[reviewer]]);
    const testId = Number(row.rows[0].id);
    if (status !== 'draft') {
      await pool.query("INSERT INTO status_history (backtest_id, from_status, to_status, changed_by, changed_at) VALUES ($1, 'draft', 'submitted', $2, '2024-02-01T10:00:00Z'::timestamptz + $3 * interval '1 minute')", [testId, id[owner], minute]);
    }
    return testId;
  };
  return { id, cookie, make };
}

test('mentor vidi samo aktivne učence s številom vseh vidnih testov in testov, ki čakajo na pregled', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make } = await setup(base, pool);
    await make('t1', 'submitted'); await make('t1', 'submitted'); await make('t1', 'in_review'); await make('t1', 'approved');
    await make('t1', 'draft'); await make('t1', 'withdrawn'); await make('t1', 'submitted', 'm2'); // osnutek, umaknjen in test drugemu mentorju se ne štejejo
    await make('t4', 'submitted'); await make('t5', 'submitted'); await make('t2', 'submitted', 'm2'); // povabljen, prekinjen in tuj učenec
    const res = await send(base, 'GET', '/api/mentor/students', cookie.m1);
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), [
      { id: id.t1, name: 'Ana', email: 't1@example.com', test_count: 4, waiting_count: 2 },
      { id: id.t3, name: 'Boris', email: 't3@example.com', test_count: 0, waiting_count: 0 },
    ]);
    assert.deepEqual((await json(await send(base, 'GET', '/api/mentor/students', cookie.m2))).map((s: any) => [s.id, s.test_count]), [[id.t2, 1]]);
  });
});

test('seznam za pregled: zavihki po stanju, privzeto submitted, čakajoči od najstarejšega, ostali od najnovejšega', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make } = await setup(base, pool);
    const late = await make('t1', 'submitted', 'm1', 30);
    const early = await make('t3', 'submitted', 'm1', 5);
    const review1 = await make('t1', 'in_review', 'm1', 10);
    const review2 = await make('t3', 'in_review', 'm1', 20);
    const changes = await make('t1', 'changes_requested');
    const approved = await make('t3', 'approved');
    await make('t1', 'draft'); await make('t1', 'withdrawn'); await make('t2', 'submitted', 'm2'); await make('t5', 'submitted');
    const list = async (query = '') => json(await send(base, 'GET', `/api/mentor/backtests${query}`, cookie.m1));
    const ids = (body: any) => body.items.map((i: any) => i.id);

    const submitted = await list();
    assert.deepEqual([submitted.status, submitted.total, submitted.pages, submitted.page, submitted.pageSize], ['submitted', 2, 1, 1, 20]);
    assert.deepEqual(ids(submitted), [early, late]);
    assert.deepEqual(submitted.items[0].owner, { id: id.t3, name: 'Boris' });
    assert.equal(new Date(submitted.items[0].submitted_at).toISOString(), '2024-02-01T10:05:00.000Z');
    assert.deepEqual([typeof submitted.items[0].strategy_name, submitted.items[0].status, submitted.items[0].from, submitted.items[0].to], ['string', 'submitted', '2024-01-01', '2024-01-03']);
    assert.deepEqual(ids(await list('?status=in_review')), [review2, review1]);
    assert.deepEqual(ids(await list('?status=changes_requested')), [changes]);
    assert.deepEqual(ids(await list('?status=approved')), [approved]);
  });
});

test('seznam za pregled ima paginacijo po 20, prazna stran za zadnjo je veljavna, neveljavni parametri so 400', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    for (let i = 0; i < 25; i++) await make('t1', 'submitted', 'm1', i);
    const page = async (n: string) => json(await send(base, 'GET', `/api/mentor/backtests?page=${n}`, cookie.m1));
    const first = await page('1');
    assert.deepEqual([first.items.length, first.total, first.pages], [20, 25, 2]);
    const second = await page('2');
    assert.deepEqual([second.items.length, second.total, second.pages], [5, 25, 2]);
    assert.equal(new Set([...first.items, ...second.items].map((i: any) => i.id)).size, 25);
    const third = await page('3');
    assert.deepEqual([third.items.length, third.total, third.pages], [0, 25, 2]);
    for (const query of ['?page=0', '?page=x', '?page=-1', '?page=1.5']) assert.equal((await send(base, 'GET', `/api/mentor/backtests${query}`, cookie.m1)).status, 400, query);
    for (const query of ['?status=draft', '?status=withdrawn', '?status=x']) {
      const res = await send(base, 'GET', `/api/mentor/backtests${query}`, cookie.m1);
      assert.equal(res.status, 400, query);
      assert.ok((await json(res)).errors.status);
    }
    const empty = await json(await send(base, 'GET', '/api/mentor/backtests?status=approved', cookie.m1));
    assert.deepEqual([empty.items, empty.total, empty.pages], [[], 0, 1]);
  });
});

test('začetek pregleda: submitted postane in_review, prehod je zapisan z mentorjem, trgovec vidi novo stanje', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make } = await setup(base, pool);
    const test = await make('t1', 'submitted');
    const res = await send(base, 'POST', `/api/backtests/${test}/start-review`, cookie.m1);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, 'in_review');
    assert.deepEqual(body.history.map((h: any) => [h.from_status, h.to_status, h.changed_by.id]), [['draft', 'submitted', id.t1], ['submitted', 'in_review', id.m1]]);
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${test}`, cookie.t1))).status, 'in_review');
    // test je zdaj v zavihku »V pregledu« in ne več med čakajočimi
    assert.equal((await json(await send(base, 'GET', '/api/mentor/backtests', cookie.m1))).total, 0);
    assert.equal((await json(await send(base, 'GET', '/api/mentor/backtests?status=in_review', cookie.m1))).total, 1);
    assert.equal((await json(await send(base, 'GET', '/api/mentor/students', cookie.m1)))[0].waiting_count, 0);
    // trgovec ne more več umakniti oddaje
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/withdraw`, cookie.t1)).status, 409);
  });
});

test('začetek pregleda v drugem stanju je 409, nevidni testi so 404, druge vloge so zavrnjene', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const start = (test: number | string, who: string | undefined) => send(base, 'POST', `/api/backtests/${test}/start-review`, who ? cookie[who] : undefined);
    for (const status of ['in_review', 'changes_requested', 'approved']) {
      const test = await make('t1', status);
      assert.equal((await start(test, 'm1')).status, 409, status);
    }
    const hidden = [await make('t1', 'draft'), await make('t1', 'withdrawn'), await make('t2', 'submitted', 'm2'), await make('t1', 'submitted', 'm2'), await make('t5', 'submitted'), await make('t4', 'submitted')];
    for (const test of hidden) assert.equal((await start(test, 'm1')).status, 404, String(test));
    assert.equal((await start(999999, 'm1')).status, 404);
    assert.equal((await start('abc', 'm1')).status, 404);
    const mine = await make('t1', 'submitted');
    assert.equal((await start(mine, 't1')).status, 403); // trgovec
    assert.equal((await start(mine, 'm2')).status, 404); // drug mentor
    assert.equal((await start(mine, undefined)).status, 401);
    assert.equal((await send(base, 'GET', `/api/backtests/${mine}/start-review`, cookie.m1)).status, 405);
    assert.equal((await start(mine, 'm1')).status, 200);
    assert.equal((await start(mine, 'm1')).status, 409); // drugič ne podvoji zgodovine
    assert.equal(Number((await pool.query("SELECT count(*) FROM status_history WHERE backtest_id = $1 AND to_status = 'in_review'", [mine])).rows[0].count), 1);
  });
});

test('poti mentorjevega dashboarda so samo za mentorje', async () => {
  await withApp(async (base, pool) => {
    const { cookie } = await setup(base, pool);
    await addUser(pool, 'admin');
    const admin = await loginCookie(base, 'admin@example.com');
    for (const path of ['/api/mentor/students', '/api/mentor/backtests']) {
      assert.equal((await send(base, 'GET', path, cookie.t1)).status, 403, path);
      assert.equal((await send(base, 'GET', path, admin)).status, 403, path);
      assert.equal((await send(base, 'GET', path)).status, 401, path);
      assert.equal((await send(base, 'POST', path, cookie.m1)).status, 405, path);
    }
  });
});
