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

async function setup(base: string, pool: Pool) {
  for (const [role, email] of [['admin', 'admin@example.com'], ['trader', 't@example.com'], ['mentor', 'm@example.com']]) await addUser(pool, role!, email!);
  return { admin: await loginCookie(base, 'admin@example.com'), trader: await loginCookie(base, 't@example.com'), mentor: await loginCookie(base, 'm@example.com') };
}
// Test, ki uporablja dano borzo, načrt in sredstvo; rezultat hrani lastne zneske.
async function usedTest(pool: Pool, venue: string, plan: string | null, ticker: string) {
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  const owner = (await pool.query("SELECT id FROM users WHERE email = 't@example.com'")).rows[0].id;
  const results = { netProfit: 5, challenge: { maxDailyLoss: { allowed: 4000 } } };
  const id = (await pool.query(
    `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, prop_plan_id, challenge_passed)
     VALUES ($1, $2, $3, '2024-01-01', '2024-01-03', '{}', $4, $5, $6) RETURNING id`, [owner, strategy, venue, results, plan, plan ? true : null])).rows[0].id;
  await pool.query('INSERT INTO backtest_instruments (backtest_id, ticker) VALUES ($1, $2)', [id, ticker]);
  return Number(id);
}

const VENUE = { id: 'moja-borza', name: 'Moja borza', maker_pct: 0.0002, taker_pct: 0.0005, pay_spread: false };
const PLAN = { id: 'moj-nacrt', firm_name: 'Firma', plan_name: 'Načrt 10k', account_size: 10000, max_daily_loss: 500, max_total_loss: 1000, profit_target: 1000 };
const INSTRUMENT = { ticker: 'TEST.X', description: 'Testno sredstvo', asset_class: 'crypto' };

test('administrator ustvari, uredi, poišče in izbriše borzo, načrt in sredstvo', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    for (const [path, item, edit] of [
      ['venues', VENUE, { name: 'Preimenovana', maker_pct: 0, taker_pct: 0.001, pay_spread: true }],
      ['prop-plans', PLAN, { firm_name: 'Druga', plan_name: 'Nov', account_size: 20000, max_daily_loss: 900, max_total_loss: 1500, profit_target: 2000 }],
      ['instruments', INSTRUMENT, { description: 'Spremenjen opis', asset_class: 'forex' }],
    ] as const) {
      const key = (item as any).id ?? (item as any).ticker;
      const created = await send(base, 'POST', `/api/admin/${path}`, admin, item);
      assert.equal(created.status, 201, path);
      assert.equal((await json(created)).used_by, 0);
      assert.equal((await send(base, 'POST', `/api/admin/${path}`, admin, item)).status, 409, `${path} dvojnik`);
      const found = await json(await send(base, 'GET', `/api/admin/${path}?q=${encodeURIComponent(key.slice(1, 5))}`, admin));
      assert.ok(found.some((row: any) => (row.id ?? row.ticker) === key), `${path} iskanje`);
      const updated = await send(base, 'PUT', `/api/admin/${path}/${encodeURIComponent(key)}`, admin, { ...item, ...edit });
      assert.equal(updated.status, 200, path);
      const row = (await json(await send(base, 'GET', `/api/admin/${path}?q=${encodeURIComponent(key)}`, admin))).find((r: any) => (r.id ?? r.ticker) === key);
      for (const [k, v] of Object.entries(edit)) assert.equal(row[k], v, `${path}.${k}`);
      assert.equal((await send(base, 'DELETE', `/api/admin/${path}/${encodeURIComponent(key)}`, admin)).status, 200, path);
      assert.equal((await send(base, 'DELETE', `/api/admin/${path}/${encodeURIComponent(key)}`, admin)).status, 404);
      assert.equal((await send(base, 'PUT', `/api/admin/${path}/${encodeURIComponent(key)}`, admin, { ...item, ...edit })).status, 404);
    }
  });
});

test('iskanje je nepodvrženo velikosti črk in jemlje % in _ dobesedno', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    const names = async (q: string) => (await json(await send(base, 'GET', `/api/admin/venues?q=${encodeURIComponent(q)}`, admin))).map((v: any) => v.id);
    assert.deepEqual(await names('WEEX'), ['weex-futures', 'weex-spot']);
    assert.deepEqual(await names('%'), []);
    assert.deepEqual(await names('_'), []);
    assert.ok((await names('')).length >= 5);
  });
});

test('obvezna polja, števila in ključ se preverijo (400 s polji)', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    const bad = async (path: string, body: unknown, ...fields: string[]) => {
      const res = await send(base, 'POST', `/api/admin/${path}`, admin, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      const errors = (await json(res)).errors;
      for (const f of fields) assert.ok(errors[f], `${f} v ${JSON.stringify(body)}`);
    };
    await bad('venues', {}, 'id', 'name', 'maker_pct', 'taker_pct', 'pay_spread');
    await bad('venues', { ...VENUE, maker_pct: -0.1 }, 'maker_pct');
    await bad('venues', { ...VENUE, taker_pct: '0.1' }, 'taker_pct');
    await bad('venues', { ...VENUE, taker_pct: 2 }, 'taker_pct');
    await bad('venues', { ...VENUE, pay_spread: 'da' }, 'pay_spread');
    await bad('venues', { ...VENUE, id: 'Velike Črke' }, 'id');
    await bad('venues', { ...VENUE, name: '   ' }, 'name');
    await bad('prop-plans', {}, 'id', 'firm_name', 'plan_name', 'account_size', 'max_daily_loss', 'max_total_loss', 'profit_target');
    await bad('prop-plans', { ...PLAN, account_size: -1, max_daily_loss: 0 }, 'account_size', 'max_daily_loss');
    await bad('prop-plans', { ...PLAN, profit_target: '1000' }, 'profit_target');
    await bad('instruments', { ...INSTRUMENT, asset_class: 'akcije' }, 'asset_class');
    await bad('instruments', { ...INSTRUMENT, ticker: 'mala' }, 'ticker');
    await bad('instruments', { ...INSTRUMENT, description: '' }, 'description');
    assert.equal((await send(base, 'POST', '/api/admin/venues', admin, [])).status, 400);
    const put = await send(base, 'PUT', '/api/admin/venues/gross', admin, { ...VENUE, id: 'drug', maker_pct: 0 });
    assert.equal(put.status, 400);
    assert.ok((await json(put)).errors.id); // ključ se ne spreminja
    assert.equal((await send(base, 'PUT', '/api/admin/venues/gross', admin, { ...VENUE, maker_pct: -1 })).status, 400);
    assert.equal((await pool.query("SELECT name FROM venues WHERE id = 'gross'")).rows[0].name, 'No costs (gross)');
  });
});

test('zapisa, ki ga uporablja test, ni mogoče izbrisati (409 s številom testov); neuporabljen se izbriše', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    await usedTest(pool, 'weex-spot', 'topstep-50k', 'EURUSD');
    await usedTest(pool, 'weex-spot', null, 'EURUSD');
    for (const [path, key, tests] of [['venues', 'weex-spot', 2], ['prop-plans', 'topstep-50k', 1], ['instruments', 'EURUSD', 2]] as const) {
      const res = await send(base, 'DELETE', `/api/admin/${path}/${key}`, admin);
      assert.equal(res.status, 409, path);
      const body = await json(res);
      assert.equal(body.tests, tests);
      assert.match(body.error, new RegExp(String(tests)));
      const row = (await json(await send(base, 'GET', `/api/admin/${path}?q=${key}`, admin))).find((r: any) => (r.id ?? r.ticker) === key);
      assert.equal(row.used_by, tests);
    }
    // zapis ostane, razponi sredstva prav tako
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM spreads WHERE ticker = 'EURUSD'")).rows[0].n > 0, true);
    // neuporabljeno sredstvo z razponi se izbriše skupaj z razponi
    await pool.query("INSERT INTO instruments (ticker, description, asset_class) VALUES ('SPR.X', 'x', 'forex')");
    await pool.query("INSERT INTO spreads (ticker, year, spread) VALUES ('SPR.X', 2020, 0.1)");
    assert.equal((await send(base, 'DELETE', '/api/admin/instruments/SPR.X', admin)).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM spreads WHERE ticker = 'SPR.X'")).rows[0].n, 0);
  });
});

test('sprememba borze ali načrta ne spremeni že shranjenih rezultatov (P8)', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    const id = await usedTest(pool, 'weex-spot', 'ftmo-2step-100k', 'BTCUSDT');
    const stored = async () => JSON.stringify((await pool.query('SELECT results, challenge_passed, venue_id, prop_plan_id FROM backtests WHERE id = $1', [id])).rows[0]);
    const before = await stored();
    assert.equal((await send(base, 'PUT', '/api/admin/venues/weex-spot', admin, { name: 'Nova borza', maker_pct: 0.5, taker_pct: 0.5, pay_spread: true })).status, 200);
    assert.equal((await send(base, 'PUT', '/api/admin/prop-plans/ftmo-2step-100k', admin, { ...PLAN, id: undefined, max_daily_loss: 1 })).status, 200);
    assert.equal(await stored(), before);
  });
});

test('trgovec, mentor in neprijavljen ne moreta brati ali spreminjati vzdrževanih podatkov (403, 401)', async () => {
  await withApp(async (base, pool) => {
    const cookie = await setup(base, pool);
    for (const who of ['trader', 'mentor'] as const) {
      for (const [method, path, body] of [
        ['GET', '/api/admin/venues', undefined], ['POST', '/api/admin/venues', VENUE], ['PUT', '/api/admin/venues/gross', VENUE], ['DELETE', '/api/admin/venues/gross', undefined],
        ['POST', '/api/admin/prop-plans', PLAN], ['DELETE', '/api/admin/prop-plans/topstep-50k', undefined],
        ['POST', '/api/admin/instruments', INSTRUMENT], ['PUT', '/api/admin/instruments/EURUSD', INSTRUMENT],
      ] as const) assert.equal((await send(base, method, path, cookie[who], body)).status, 403, `${who} ${method} ${path}`);
      // za izbiro v obrazcih ostanejo seznami brez vzdrževanja dostopni
      for (const path of ['/api/venues', '/api/prop-plans', '/api/instruments']) assert.equal((await send(base, 'GET', path, cookie[who])).status, 200);
    }
    assert.equal((await send(base, 'POST', '/api/admin/venues', undefined, VENUE)).status, 401);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM venues WHERE id = $1', [VENUE.id])).rows[0].n, 0);
  });
});
