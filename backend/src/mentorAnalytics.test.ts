import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const get = (base: string, path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
const json = async (res: Response) => (await res.json()) as any;

async function setup(base: string, pool: Pool) {
  const emails = ['m@example.com', 'm2@example.com', 'a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'];
  for (const email of emails) await addUser(pool, email.startsWith('m') ? 'mentor' : 'trader', email);
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  await pool.query("UPDATE users SET name = 'Ana' WHERE email = 'a@example.com'");
  await pool.query("UPDATE users SET name = 'Bor' WHERE email = 'b@example.com'");
  const link = async (mentor: string, trader: string, status: string) =>
    pool.query('INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, $3)', [await idOf(mentor), await idOf(trader), status]);
  await link('m@example.com', 'a@example.com', 'active');
  await link('m@example.com', 'b@example.com', 'active');
  await link('m@example.com', 'c@example.com', 'ended'); // prekinjena povezava
  await link('m@example.com', 'd@example.com', 'invited'); // še ni sprejel
  await link('m2@example.com', 'e@example.com', 'active'); // učenec drugega mentorja
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  // Test z oddajo pred `daysAgo` dnevi; vrne id.
  const make = async (owner: string, status: string, drawdown: number, daysAgo = 1, mentor = 'm@example.com') => {
    const id = Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, status, reviewer_id)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{}', $3, $4, $5) RETURNING id`,
      [await idOf(owner), strategy, { maxDrawdownPct: drawdown }, status, status === 'draft' ? null : await idOf(mentor)])).rows[0].id);
    if (status !== 'draft') {
      await pool.query(
        "INSERT INTO status_history (backtest_id, from_status, to_status, changed_by, changed_at) VALUES ($1, 'draft', 'submitted', $2, now() - $3::int * interval '1 day')",
        [id, await idOf(owner), daysAgo]);
    }
    return id;
  };
  const mistake = async (id: number, count: number, notes = 0) => {
    for (let i = 0; i < count; i++) await pool.query("INSERT INTO comments (backtest_id, author_id, body, is_mistake) VALUES ($1, (SELECT id FROM users WHERE email = 'm@example.com'), 'napaka', true)", [id]);
    for (let i = 0; i < notes; i++) await pool.query("INSERT INTO comments (backtest_id, author_id, body, is_mistake) VALUES ($1, (SELECT id FROM users WHERE email = 'm@example.com'), 'opomba', false)", [id]);
  };
  return { cookie: { m: await loginCookie(base, 'm@example.com'), m2: await loginCookie(base, 'm2@example.com'), a: await loginCookie(base, 'a@example.com') }, make, mistake };
}

test('analitika: aktivni učenci, štetje testov, deleža odobrenih, napak in povprečnega padca ter skupna vsota in povprečje', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, mistake } = await setup(base, pool);
    const a1 = await make('a@example.com', 'approved', 4);
    const a2 = await make('a@example.com', 'in_review', 6);
    await make('a@example.com', 'draft', 99); // osnutek se ne šteje
    await make('a@example.com', 'withdrawn', 99); // umaknjen se ne šteje
    await mistake(a1, 2, 3); // šteje samo is_mistake
    await mistake(a2, 1);
    await make('b@example.com', 'approved', 10);
    await make('c@example.com', 'approved', 50); // prekinjena povezava
    await make('d@example.com', 'approved', 50); // neaktivno vabilo
    await make('e@example.com', 'approved', 50, 1, 'm2@example.com'); // učenec drugega mentorja

    const body = await json(await get(base, '/api/mentor/students/analytics', cookie.m));
    assert.equal(body.period, 'all');
    assert.deepEqual(body.students.map((s: any) => [s.name, s.tests, s.approved, s.approvedPct, s.mistakes, s.avgMaxDrawdownPct]),
      [['Ana', 2, 1, 50, 3, 5], ['Bor', 1, 1, 100, 0, 10]]);
    assert.deepEqual(body.total, { tests: 3, approved: 2, mistakes: 3 });
    // povprečje: 1,5 testa in 1 napaka na učenca; delež in padec čez vse teste ((4 + 6 + 10) / 3)
    assert.deepEqual(body.average, { testsPerStudent: 1.5, mistakesPerStudent: 1.5, approvedPct: 66.67, avgMaxDrawdownPct: 6.67 });
    // drug mentor vidi samo svojega učenca
    const other = await json(await get(base, '/api/mentor/students/analytics', cookie.m2));
    assert.deepEqual(other.students.map((s: any) => [s.name, s.tests]), [['Test trader', 1]]);
  });
});

test('analitika: obdobje 30 dni, 90 dni in vse (po času zadnje oddaje); neveljavno obdobje je 400', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make } = await setup(base, pool);
    await make('a@example.com', 'approved', 2, 5);
    await make('a@example.com', 'approved', 4, 45);
    await make('a@example.com', 'approved', 6, 200);
    const tests = async (period?: string) => {
      const body = await json(await get(base, `/api/mentor/students/analytics${period ? `?period=${period}` : ''}`, cookie.m));
      return [body.period, body.students[0].tests, body.students[0].avgMaxDrawdownPct];
    };
    assert.deepEqual(await tests(), ['all', 3, 4]);
    assert.deepEqual(await tests('all'), ['all', 3, 4]);
    assert.deepEqual(await tests('90'), ['90', 2, 3]);
    assert.deepEqual(await tests('30'), ['30', 1, 2]);
    for (const bad of ['7', 'vse', '', '30;1']) assert.equal((await get(base, `/api/mentor/students/analytics?period=${bad}`, cookie.m)).status, 400, bad);
  });
});

test('analitika: brez učencev ali brez testov so prazna stanja (null, ne 0 in ne napaka)', async () => {
  await withApp(async (base, pool) => {
    for (const email of ['m@example.com', 'a@example.com']) await addUser(pool, email.startsWith('m') ? 'mentor' : 'trader', email);
    const cookie = await loginCookie(base, 'm@example.com');
    const none = await json(await get(base, '/api/mentor/students/analytics', cookie));
    assert.deepEqual(none, { period: 'all', students: [], total: { tests: 0, approved: 0, mistakes: 0 }, average: null });

    await pool.query("INSERT INTO mentor_links (mentor_id, trader_id, status) SELECT m.id, t.id, 'active' FROM users m, users t WHERE m.email = 'm@example.com' AND t.email = 'a@example.com'");
    const noTests = await json(await get(base, '/api/mentor/students/analytics', cookie));
    assert.deepEqual(noTests.students.map((s: any) => [s.tests, s.approvedPct, s.mistakes, s.avgMaxDrawdownPct]), [[0, null, 0, null]]);
    assert.deepEqual(noTests.average, { testsPerStudent: 0, mistakesPerStudent: 0, approvedPct: null, avgMaxDrawdownPct: null });
  });
});

test('analitika je samo za mentorje (401, trgovec 403)', async () => {
  await withApp(async (base, pool) => {
    const { cookie } = await setup(base, pool);
    assert.equal((await get(base, '/api/mentor/students/analytics')).status, 401);
    assert.equal((await get(base, '/api/mentor/students/analytics', cookie.a)).status, 403);
  });
});
