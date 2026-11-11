import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

interface Item {
  id: number;
  name: string;
  author: string;
  visibility: string;
  system: boolean;
  mine: boolean;
}

const userId = async (pool: Pool, email: string) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;
const addStrategy = (pool: Pool, owner: string, name: string, visibility: string) =>
  pool.query("INSERT INTO strategies (owner_id, name, description, source, visibility) VALUES ($1, $2, 'opis', 'export default () => []', $3) RETURNING id", [
    owner,
    name,
    visibility,
  ]);

// Prijavi tri trgovce: ana (lastnica), bor (tuj) in cene (tuj); doda zasebne in deljene strategije.
async function setup(base: string, pool: Pool) {
  const ana = await addUser(pool, 'trader', 'ana@example.com');
  const bor = await addUser(pool, 'trader', 'bor@example.com');
  const anaId = await userId(pool, ana);
  const borId = await userId(pool, bor);
  await addStrategy(pool, anaId, 'Anina zasebna', 'private');
  await addStrategy(pool, anaId, 'Anina deljena', 'shared');
  await addStrategy(pool, borId, 'Borova zasebna', 'private');
  await addStrategy(pool, borId, 'Borova deljena', 'shared');
  return { anaCookie: await loginCookie(base, ana), borCookie: await loginCookie(base, bor) };
}

const get = (base: string, path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });

test('GET /api/strategies vrne sistemske, lastne in deljene strategije drugih, ne pa tujih zasebnih', async () => {
  await withApp(async (base, pool) => {
    const { anaCookie, borCookie } = await setup(base, pool);

    const res = await get(base, '/api/strategies', anaCookie);
    assert.equal(res.status, 200);
    const list = (await res.json()) as Item[];
    assert.deepEqual(list.map((s) => s.name), ['Nakup in zadrži', 'Presek drsečih povprečij (SMA)', 'Preboj (Donchian)', 'Anina zasebna', 'Anina deljena', 'Borova deljena']);

    const system = list.filter((s) => s.system);
    assert.equal(system.length, 3);
    assert.ok(system.every((s) => s.author === 'Sistem' && s.visibility === 'shared' && !s.mine));
    assert.deepEqual(list.filter((s) => s.mine).map((s) => s.name), ['Anina zasebna', 'Anina deljena']);
    const tuja = list.find((s) => s.name === 'Borova deljena')!;
    assert.deepEqual([tuja.author, tuja.visibility, tuja.mine], ['Test trader', 'shared', false]);

    const bor = (await (await get(base, '/api/strategies', borCookie)).json()) as Item[];
    assert.ok(!bor.some((s) => s.name === 'Anina zasebna'));
    assert.ok(bor.some((s) => s.name === 'Anina deljena'));
  });
});

test('seznam ne razkrije kode in lastnika strategije', async () => {
  await withApp(async (base, pool) => {
    const { anaCookie } = await setup(base, pool);
    const [first] = (await (await get(base, '/api/strategies', anaCookie)).json()) as Record<string, unknown>[];
    assert.deepEqual(Object.keys(first!).sort(), ['author', 'description', 'id', 'mine', 'name', 'system', 'visibility']);
  });
});

test('GET /api/strategies/:id vrne podrobnosti s kodo in privzetimi parametri', async () => {
  await withApp(async (base, pool) => {
    const { anaCookie } = await setup(base, pool);
    const list = (await (await get(base, '/api/strategies', anaCookie)).json()) as Item[];
    const sma = list.find((s) => s.name === 'Presek drsečih povprečij (SMA)')!;

    const res = await get(base, `/api/strategies/${sma.id}`, anaCookie);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.name, 'Presek drsečih povprečij (SMA)');
    assert.equal(body.author, 'Sistem');
    assert.deepEqual(body.default_params, { hitro_povprecje: 10, pocasno_povprecje: 30 });
    assert.match(body.source as string, /^export default/);
  });
});

test('tuja zasebna strategija in neobstoječa vrneta 404, tuja deljena je dostopna', async () => {
  await withApp(async (base, pool) => {
    const { anaCookie, borCookie } = await setup(base, pool);
    const idOf = async (name: string) => ((await pool.query('SELECT id FROM strategies WHERE name = $1', [name])).rows[0].id as string);

    assert.equal((await get(base, `/api/strategies/${await idOf('Borova zasebna')}`, anaCookie)).status, 404);
    assert.equal((await get(base, `/api/strategies/${await idOf('Borova deljena')}`, anaCookie)).status, 200);
    assert.equal((await get(base, `/api/strategies/${await idOf('Borova zasebna')}`, borCookie)).status, 200);
    assert.equal((await get(base, '/api/strategies/99999', anaCookie)).status, 404);
    assert.equal((await get(base, '/api/strategies/abc', anaCookie)).status, 404);
    assert.equal((await get(base, '/api/strategies/1/2', anaCookie)).status, 404);
  });
});

test('strategije zahtevajo prijavo, nepodprte metode so zavrnjene', async () => {
  await withApp(async (base, pool) => {
    const { anaCookie } = await setup(base, pool);
    assert.equal((await get(base, '/api/strategies')).status, 401);
    assert.equal((await get(base, '/api/strategies/1')).status, 401);
    const put = await fetch(`${base}/api/strategies`, { method: 'PUT', headers: { Cookie: anaCookie } });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get('allow'), 'GET, POST');
    assert.equal((await fetch(`${base}/api/strategies/1`, { method: 'PUT', headers: { Cookie: anaCookie } })).status, 405);
  });
});

test('administrator ne vidi zasebnih strategij uporabnikov', async () => {
  await withApp(async (base, pool) => {
    await setup(base, pool);
    const admin = await loginCookie(base, await addUser(pool, 'admin'));
    const list = (await (await get(base, '/api/strategies', admin)).json()) as Item[];
    assert.deepEqual(list.map((s) => s.name), ['Nakup in zadrži', 'Presek drsečih povprečij (SMA)', 'Preboj (Donchian)', 'Anina deljena', 'Borova deljena']);
  });
});
