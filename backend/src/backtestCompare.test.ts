import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const get = (base: string, path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
const json = async (res: Response) => (await res.json()) as any;

async function setup(base: string, pool: Pool) {
  for (const [role, email] of [['trader', 'a@example.com'], ['trader', 'b@example.com'], ['mentor', 'm@example.com']]) await addUser(pool, role!, email!);
  const cookie = { a: await loginCookie(base, 'a@example.com'), b: await loginCookie(base, 'b@example.com'), m: await loginCookie(base, 'm@example.com') };
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  const make = async (owner: string, netProfit: number, visibility = 'private') => {
    const results = {
      initialCapital: 10000, netProfit, returnPct: netProfit / 100, tradeCount: 3, winRatePct: 50, maxDrawdownPct: 2.5,
      equityCurve: [{ date: '2024-01-01', value: 10000 }, { date: '2024-01-02', value: 10000 + netProfit }], trades: [{ entryTime: 1 }],
    };
    return Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, status, reviewer_id, visibility)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-02', '{"fast": 5}', $3, 'approved', $4, $5) RETURNING id`,
      [await idOf(owner), strategy, results, await idOf('m@example.com'), visibility])).rows[0].id);
  };
  return { cookie, make };
}

test('primerjava 2–4 testov vrne metrike in krivulje v vrstnem redu, kot so bili izbrani (brez poslov)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const [x, y, z] = [await make('a@example.com', 100), await make('a@example.com', 300), await make('a@example.com', 200)];
    const body = await json(await get(base, `/api/backtests/compare?ids=${z},${x},${y}`, cookie.a));
    assert.deepEqual(body.tests.map((t: any) => t.id), [z, x, y]);
    const first = body.tests[0];
    assert.equal(first.strategy_name.length > 0, true);
    assert.deepEqual([first.venue_id, first.from, first.to, first.params, first.instruments], ['gross', '2024-01-01', '2024-01-02', { fast: 5 }, []]);
    assert.deepEqual([first.results.netProfit, first.results.returnPct, first.results.tradeCount, first.results.maxDrawdownPct], [200, 2, 3, 2.5]);
    assert.equal(first.results.equityCurve.length, 2);
    assert.equal('trades' in first.results, false);
    assert.equal(first.challenge_passed, null);
    assert.equal((await get(base, `/api/backtests/compare?ids=${x},${y}`, cookie.a)).status, 200);
    const four = await make('a@example.com', 1);
    assert.equal((await get(base, `/api/backtests/compare?ids=${x},${y},${z},${four}`, cookie.a)).status, 200);
  });
});

test('število izbranih testov mora biti 2–4 in id-ji veljavni (400)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const ids = [] as number[];
    for (let i = 0; i < 5; i++) ids.push(await make('a@example.com', i));
    for (const query of ['', 'ids=', `ids=${ids[0]}`, `ids=${ids.join(',')}`, `ids=${ids[0]},${ids[0]}`, `ids=${ids[0]},abc`, `ids=${ids[0]},`, `ids=${ids[0]},-1`, `ids=0,${ids[1]}`]) {
      const res = await get(base, `/api/backtests/compare?${query}`, cookie.a);
      assert.equal(res.status, 400, query);
      assert.ok((await json(res)).errors.ids, query);
    }
  });
});

test('tuj zaseben ali neobstoječ test ni primerljiv: 404 za celoto (P1)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const mine = await make('a@example.com', 100);
    const foreign = await make('b@example.com', 50);
    const missing = foreign + 1000;
    assert.equal((await get(base, `/api/backtests/compare?ids=${mine},${foreign}`, cookie.a)).status, 404);
    assert.equal((await get(base, `/api/backtests/compare?ids=${mine},${missing}`, cookie.a)).status, 404);
    // odgovor je enak za tuj in neobstoječ test
    assert.deepEqual(await json(await get(base, `/api/backtests/compare?ids=${mine},${foreign}`, cookie.a)), await json(await get(base, `/api/backtests/compare?ids=${mine},${missing}`, cookie.a)));
  });
});

test('deljen tuj test je primerljiv (brez mentorja), po vrnitvi na zasebno pa ne več', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const mine = await make('a@example.com', 100);
    const shared = await make('b@example.com', 50, 'shared');
    const body = await json(await get(base, `/api/backtests/compare?ids=${mine},${shared}`, cookie.a));
    assert.equal(body.tests[1].owner.name, 'Test trader');
    assert.equal(JSON.stringify(body).includes('reviewer'), false);
    await pool.query("UPDATE backtests SET visibility = 'private' WHERE id = $1", [shared]);
    assert.equal((await get(base, `/api/backtests/compare?ids=${mine},${shared}`, cookie.a)).status, 404);
  });
});

test('primerjava je samo za prijavljene trgovce (401, mentor 403)', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    const ids = [await make('a@example.com', 1), await make('a@example.com', 2)];
    assert.equal((await get(base, `/api/backtests/compare?ids=${ids.join(',')}`)).status, 401);
    assert.equal((await get(base, `/api/backtests/compare?ids=${ids.join(',')}`, cookie.m)).status, 403);
  });
});
