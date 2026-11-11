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
const catalog = async (base: string, cookie: string, query = '') => json(await send(base, 'GET', `/api/strategy-catalog${query}`, cookie));
const names = (body: any) => body.items.map((i: any) => i.name);

// Trgovca a in b, mentor in administrator.
async function setup(base: string, pool: Pool) {
  for (const [role, email] of [['trader', 'a@example.com'], ['trader', 'b@example.com'], ['mentor', 'm@example.com'], ['admin', 'admin@example.com']]) await addUser(pool, role!, email!);
  const cookie = {
    a: await loginCookie(base, 'a@example.com'), b: await loginCookie(base, 'b@example.com'),
    m: await loginCookie(base, 'm@example.com'), admin: await loginCookie(base, 'admin@example.com'),
  };
  const idOf = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  const add = async (owner: string, name: string, visibility = 'private') =>
    Number((await pool.query(
      `INSERT INTO strategies (owner_id, name, description, source, default_params, visibility) VALUES ($1, $2, 'opis', 'export default () => []', '{}', $3) RETURNING id`,
      [await idOf(owner), name, visibility])).rows[0].id);
  return { cookie, add };
}

test('katalog prikaže sistemske, lastne in tuje deljene strategije z avtorjem in vidnostjo, tuje zasebne pa ne', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    await add('a@example.com', 'Moja zasebna');
    await add('a@example.com', 'Moja deljena', 'shared');
    await add('b@example.com', 'Tuja zasebna');
    await add('b@example.com', 'Tuja deljena', 'shared');
    const body = await catalog(base, cookie.a);
    const system = (await pool.query('SELECT count(*)::int AS n FROM strategies WHERE owner_id IS NULL')).rows[0].n;
    assert.equal(body.total, system + 3);
    assert.ok(!names(body).includes('Tuja zasebna'));
    const byName = (name: string) => body.items.find((i: any) => i.name === name);
    assert.deepEqual([byName('Moja zasebna').mine, byName('Moja zasebna').visibility, byName('Moja zasebna').author], [true, 'private', 'Test trader']);
    assert.deepEqual([byName('Tuja deljena').mine, byName('Tuja deljena').visibility], [false, 'shared']);
    assert.equal(body.items.find((i: any) => i.system).author, 'Sistem');
    assert.equal(typeof body.items[0].description, 'string');
    assert.equal(body.items[0].source, undefined); // izvorne kode katalog ne vrača
  });
});

test('filter po izvoru: Vse, Moje, Sistemske, Deljene; neveljaven izvor je 400', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    await add('a@example.com', 'Moja zasebna');
    await add('a@example.com', 'Moja deljena', 'shared');
    await add('b@example.com', 'Tuja zasebna');
    await add('b@example.com', 'Tuja deljena', 'shared');
    assert.deepEqual(names(await catalog(base, cookie.a, '?source=mine')), ['Moja zasebna', 'Moja deljena']);
    assert.deepEqual(names(await catalog(base, cookie.a, '?source=shared')), ['Moja deljena', 'Tuja deljena']); // sistemske niso »deljene«
    const system = await catalog(base, cookie.a, '?source=system');
    assert.ok(system.items.length > 0 && system.items.every((i: any) => i.system && i.author === 'Sistem'));
    assert.equal((await catalog(base, cookie.a, '?source=all')).total, system.total + 3);
    assert.equal((await catalog(base, cookie.a)).source, 'all');
    const bad = await send(base, 'GET', '/api/strategy-catalog?source=vse', cookie.a);
    assert.equal(bad.status, 400);
    assert.ok((await json(bad)).errors.source);
  });
});

test('iskanje po imenu deluje od 3 znakov, ne razlikuje velikosti črk, % in _ sta navadna znaka', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    await add('a@example.com', 'Momentum RSI');
    await add('a@example.com', 'Mean reversion');
    await add('a@example.com', '50% hitri_SMA');
    const find = async (q: string) => names(await catalog(base, cookie.a, `?source=mine&q=${encodeURIComponent(q)}`));
    assert.deepEqual(await find('mom'), ['Momentum RSI']);
    assert.deepEqual(await find('  mOM '), ['Momentum RSI']); // obrezano, brez razlikovanja velikosti črk
    assert.deepEqual(await find('m'), ['Momentum RSI', 'Mean reversion', '50% hitri_SMA']); // pod 3 znaki: brez iskanja
    assert.deepEqual(await find('me'), ['Momentum RSI', 'Mean reversion', '50% hitri_SMA']);
    assert.deepEqual(await find('Mea'), ['Mean reversion']);
    assert.deepEqual(await find('0% h'), ['50% hitri_SMA']);
    assert.deepEqual(await find('i_S'), ['50% hitri_SMA']);
    assert.deepEqual(await find('%%%'), []); // ne deluje kot nadomestni znak
    assert.deepEqual(await find('___'), []);
    assert.deepEqual(await find('zzz'), []);
    const empty = await catalog(base, cookie.a, '?source=mine&q=zzz');
    assert.deepEqual([empty.total, empty.pages, empty.q], [0, 1, 'zzz']);
    // iskanje ne razkrije tujih zasebnih strategij
    await add('b@example.com', 'Skrita strategija');
    assert.deepEqual(names(await catalog(base, cookie.a, '?q=skrita')), []);
    assert.deepEqual(names(await catalog(base, cookie.b, '?q=skrita')), ['Skrita strategija']);
  });
});

test('paginacija po 20: skupno število, strani in prazna stran za zadnjo', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    for (let i = 1; i <= 25; i++) await add('a@example.com', `Strategija ${String(i).padStart(2, '0')}`);
    const first = await catalog(base, cookie.a, '?source=mine&page=1');
    assert.deepEqual([first.items.length, first.total, first.pages, first.page, first.pageSize], [20, 25, 2, 1, 20]);
    const second = await catalog(base, cookie.a, '?source=mine&page=2');
    assert.deepEqual(names(second), ['Strategija 21', 'Strategija 22', 'Strategija 23', 'Strategija 24', 'Strategija 25']);
    const third = await catalog(base, cookie.a, '?source=mine&page=3');
    assert.deepEqual([third.items.length, third.total, third.pages], [0, 25, 2]);
    for (const page of ['0', 'x', '-1', '1.5']) assert.equal((await send(base, 'GET', `/api/strategy-catalog?page=${page}`, cookie.a)).status, 400, page);
  });
});

test('katalog je samo za trgovce (403), neprijavljen 401, drugih metod ni (405)', async () => {
  await withApp(async (base, pool) => {
    const { cookie } = await setup(base, pool);
    for (const who of ['m', 'admin'] as const) assert.equal((await send(base, 'GET', '/api/strategy-catalog', cookie[who])).status, 403, who);
    assert.equal((await send(base, 'GET', '/api/strategy-catalog')).status, 401);
    assert.equal((await send(base, 'POST', '/api/strategy-catalog', cookie.a, {})).status, 405);
  });
});

test('lastnik preklopi vidnost strategije: deljena je takoj vidna drugim, ob private takoj izgine, teste drugih ohrani', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    const id = await add('a@example.com', 'Za deljenje');
    assert.deepEqual(names(await catalog(base, cookie.b, '?q=Za d')), []);
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, cookie.b)).status, 404);

    const shared = await send(base, 'PUT', `/api/strategies/${id}/visibility`, cookie.a, { visibility: 'shared' });
    assert.equal(shared.status, 200);
    assert.equal((await json(shared)).visibility, 'shared');
    assert.deepEqual(names(await catalog(base, cookie.b, '?source=shared')), ['Za deljenje']);
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, cookie.b)).status, 200);
    assert.ok((await json(await send(base, 'GET', '/api/strategies', cookie.b))).some((s: any) => s.id === id));

    // drug trgovec test s to strategijo izvede in je njegov
    await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results)
       VALUES ((SELECT id FROM users WHERE email = 'b@example.com'), $1, 'gross', '2024-01-01', '2024-01-03', '{"trades": []}')`, [id]);

    const back = await send(base, 'PUT', `/api/strategies/${id}/visibility`, cookie.a, { visibility: 'private' });
    assert.equal((await json(back)).visibility, 'private');
    assert.deepEqual(names(await catalog(base, cookie.b, '?q=Za d')), []);
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, cookie.b)).status, 404);
    assert.ok(!(await json(await send(base, 'GET', '/api/strategies', cookie.b))).some((s: any) => s.id === id));
    const mine = await json(await send(base, 'GET', '/api/backtests', cookie.b));
    assert.deepEqual([mine.length, mine[0].strategy_name], [1, 'Za deljenje']); // test drugega ostane njegov
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM backtests')).rows[0].n, 1);
  });
});

test('vidnosti ne more spremeniti nihče razen lastnika (403/404), neveljavna vrednost je 400, sistemske ni mogoče spremeniti', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    const shared = await add('a@example.com', 'Deljena', 'shared');
    const hidden = await add('a@example.com', 'Zasebna');
    const put = (id: number | string, who: string | undefined, body: unknown = { visibility: 'private' }) =>
      send(base, 'PUT', `/api/strategies/${id}/visibility`, who ? cookie[who as keyof typeof cookie] : undefined, body);
    assert.equal((await put(shared, 'b')).status, 403); // vidna, a tuja
    assert.equal((await put(hidden, 'b')).status, 404); // tuja zasebna
    assert.equal((await put(999999, 'a')).status, 404);
    assert.equal((await put('abc', 'a')).status, 404);
    const system = Number((await pool.query('SELECT id FROM strategies WHERE owner_id IS NULL LIMIT 1')).rows[0].id);
    assert.equal((await put(system, 'a')).status, 403);
    assert.equal((await put(shared, 'm')).status, 403);
    assert.equal((await put(shared, 'admin')).status, 403);
    assert.equal((await put(shared, undefined)).status, 401);
    for (const body of [{}, { visibility: 'public' }, { visibility: 1 }, null]) {
      const res = await put(shared, 'a', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok((await json(res)).errors.visibility);
    }
    assert.equal((await send(base, 'GET', `/api/strategies/${shared}/visibility`, cookie.a)).status, 405);
    assert.deepEqual((await pool.query('SELECT id, visibility FROM strategies WHERE id IN ($1, $2) ORDER BY id', [shared, hidden])).rows.map((r) => r.visibility), ['shared', 'private']);
  });
});

test('deljena strategija: drugi jo lahko uporabi za svoj test, ne more je urejati ali brisati (403), nova strategija je zasebna', async () => {
  await withApp(async (base, pool) => {
    const { cookie, add } = await setup(base, pool);
    const id = await add('a@example.com', 'Deljena', 'shared');
    assert.equal((await send(base, 'PATCH', `/api/strategies/${id}`, cookie.b, { name: 'Prevzeta' })).status, 403);
    assert.equal((await send(base, 'DELETE', `/api/strategies/${id}`, cookie.b)).status, 403);
    assert.equal((await pool.query('SELECT name FROM strategies WHERE id = $1', [id])).rows[0].name, 'Deljena');
    // nova strategija je privzeto zasebna
    const created = await send(base, 'POST', '/api/strategies', cookie.a, { name: 'Nova strategija', description: '', source: 'export default () => [];', default_params: {} });
    assert.equal(created.status, 201);
    assert.equal((await json(created)).visibility, 'private');
    // drugi jo vidi in jo lahko izbere (test se ustvari prek običajne poti, če obstajajo podatki; tukaj preverimo vidnost)
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, cookie.b)).status, 200);
  });
});
