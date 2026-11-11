import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, PASSWORD, withApp } from './testApp.ts';

const send = (base: string, method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as any;
const idOf = async (pool: Pool, email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);

async function setup(base: string, pool: Pool) {
  for (const [role, email] of [['admin', 'admin@example.com'], ['trader', 't@example.com'], ['mentor', 'm@example.com']]) await addUser(pool, role!, email!);
  return { admin: await loginCookie(base, 'admin@example.com'), trader: await loginCookie(base, 't@example.com'), mentor: await loginCookie(base, 'm@example.com') };
}
const patch = (base: string, cookie: string, id: number, body: unknown) => send(base, 'PATCH', `/api/admin/users/${id}`, cookie, body);

test('seznam uporabnikov: iskanje po imenu in e-naslovu, paginacija po 20, brez gesel', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    for (let i = 0; i < 24; i++) await pool.query("INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, 'x', 'trader')", [`u${String(i).padStart(2, '0')}@primer.si`, `Uporabnik ${i}`]);
    const first = await json(await send(base, 'GET', '/api/admin/users', admin));
    assert.deepEqual([first.page, first.pageSize, first.total, first.pages, first.items.length], [1, 20, 27, 2, 20]);
    assert.ok(first.items.every((u: any) => !('password_hash' in u) && 'blocked' in u && 'role' in u && 'name' in u && 'email' in u));
    const second = await json(await send(base, 'GET', '/api/admin/users?page=2', admin));
    assert.equal(second.items.length, 7);
    assert.equal((await json(await send(base, 'GET', '/api/admin/users?page=9', admin))).items.length, 0);
    const byName = await json(await send(base, 'GET', `/api/admin/users?q=${encodeURIComponent('UPORABNIK 7')}`, admin));
    assert.deepEqual(byName.items.map((u: any) => u.name), ['Uporabnik 7']);
    const byEmail = await json(await send(base, 'GET', '/api/admin/users?q=u05@primer', admin));
    assert.deepEqual(byEmail.items.map((u: any) => u.email), ['u05@primer.si']);
    assert.equal((await json(await send(base, 'GET', '/api/admin/users?q=%25', admin))).total, 0); // % je dobesedno
    assert.equal((await json(await send(base, 'GET', '/api/admin/users?q=nihce', admin))).total, 0);
    for (const bad of ['0', 'x', '-1']) assert.equal((await send(base, 'GET', `/api/admin/users?page=${bad}`, admin)).status, 400, bad);
  });
});

test('administrator ustvari račun s poljubno vlogo; preverjanje in dvojniki', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    for (const role of ['trader', 'mentor', 'admin']) {
      const res = await send(base, 'POST', '/api/admin/users', admin, { name: `Nov ${role}`, email: `Nov.${role}@Example.com`, password: 'geslo12345', role });
      assert.equal(res.status, 201, role);
      const body = await json(res);
      assert.deepEqual([body.email, body.role, body.blocked, 'password_hash' in body], [`nov.${role}@example.com`, role, false, false]);
      assert.equal(typeof (await loginCookie(base, `nov.${role}@example.com`, 'geslo12345')), 'string'); // prijava z določenim geslom
    }
    const bad = await send(base, 'POST', '/api/admin/users', admin, { name: '', email: 'x', password: 'kratko', role: 'cesar' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys((await json(bad)).errors).sort(), ['email', 'name', 'password', 'role']);
    assert.equal((await send(base, 'POST', '/api/admin/users', admin, { name: 'Dvojnik', email: 'T@example.com', password: 'geslo12345', role: 'trader' })).status, 409);
    // samostojna registracija še vedno ne dovoli vloge admin
    assert.equal((await send(base, 'POST', '/api/auth/register', undefined, { name: 'A', email: 'a@b.si', password: 'geslo12345', role: 'admin' })).status, 400);
  });
});

test('blokiran uporabnik se ne more prijaviti, obstoječ žeton neha veljati pri naslednjem zahtevku; odblokada vse povrne', async () => {
  await withApp(async (base, pool) => {
    const { admin, trader } = await setup(base, pool);
    const id = await idOf(pool, 't@example.com');
    assert.equal((await send(base, 'GET', '/api/auth/me', trader)).status, 200);
    const blocked = await patch(base, admin, id, { blocked: true });
    assert.equal(blocked.status, 200);
    assert.equal((await json(blocked)).blocked, true);
    assert.equal((await send(base, 'GET', '/api/auth/me', trader)).status, 401); // stari žeton
    const login = await send(base, 'POST', '/api/auth/login', undefined, { email: 't@example.com', password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal((await patch(base, admin, id, { blocked: false })).status, 200);
    assert.equal((await send(base, 'GET', '/api/auth/me', trader)).status, 200);
    assert.equal(typeof (await loginCookie(base, 't@example.com')), 'string');
  });
});

test('sprememba vloge in imena: nova vloga velja od naslednjega zahtevka, neveljavni podatki so 400', async () => {
  await withApp(async (base, pool) => {
    const { admin, trader } = await setup(base, pool);
    const id = await idOf(pool, 't@example.com');
    assert.equal((await send(base, 'GET', '/api/mentor/students', trader)).status, 403);
    const res = await patch(base, admin, id, { role: 'mentor', name: '  Nova Ime  ' });
    assert.deepEqual([res.status, (await json(res)).role, (await json(await send(base, 'GET', '/api/auth/me', trader))).name], [200, 'mentor', 'Nova Ime']);
    assert.equal((await send(base, 'GET', '/api/mentor/students', trader)).status, 200);
    for (const bad of [{}, { role: 'cesar' }, { blocked: 'da' }, { name: '  ' }, [], { role: 5 }]) assert.equal((await patch(base, admin, id, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await patch(base, admin, 999999, { blocked: true })).status, 404);
    assert.equal((await send(base, 'PATCH', '/api/admin/users/abc', admin, { blocked: true })).status, 404);
  });
});

test('zaščite: administrator ne more blokirati sebe, zadnjemu administratorju se vloga ne odvzame (z razlogom)', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    const me = await idOf(pool, 'admin@example.com');
    const self = await patch(base, admin, me, { blocked: true });
    assert.equal(self.status, 409);
    assert.match((await json(self)).error, /Sebe ne morete blokirati/);
    const last = await patch(base, admin, me, { role: 'trader' });
    assert.equal(last.status, 409);
    assert.match((await json(last)).error, /zadnjemu administratorju/);
    assert.equal((await pool.query('SELECT role, blocked FROM users WHERE id = $1', [me])).rows[0].role, 'admin');
    // drugi administrator je blokiran: prvi je še vedno zadnji aktivni
    await addUser(pool, 'admin', 'admin2@example.com');
    const second = await idOf(pool, 'admin2@example.com');
    assert.equal((await patch(base, admin, second, { blocked: true })).status, 200);
    assert.equal((await patch(base, admin, me, { role: 'mentor' })).status, 409);
    // ko je drug aktiven, sme administrator odvzeti vlogo sebi
    assert.equal((await patch(base, admin, second, { blocked: false })).status, 200);
    assert.equal((await patch(base, admin, me, { role: 'mentor' })).status, 200);
    // zdaj je zadnji administrator admin2
    const admin2 = await loginCookie(base, 'admin2@example.com');
    assert.equal((await patch(base, admin2, second, { role: 'trader' })).status, 409);
    // ime zadnjega administratorja se sme spremeniti
    assert.equal((await patch(base, admin2, second, { name: 'Glavni' })).status, 200);
  });
});

test('dva administratorja, ki si sočasno odvzameta vlogo: uspe samo eden, vsaj en ostane', async () => {
  await withApp(async (base, pool) => {
    await addUser(pool, 'admin', 'a1@example.com');
    await addUser(pool, 'admin', 'a2@example.com');
    const [c1, c2] = [await loginCookie(base, 'a1@example.com'), await loginCookie(base, 'a2@example.com')];
    const [i1, i2] = [await idOf(pool, 'a1@example.com'), await idOf(pool, 'a2@example.com')];
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all([patch(base, c1, i2, { role: 'trader' }), patch(base, c2, i1, { role: 'trader' })]);
      const codes = results.map((r) => r.status).sort();
      const active = (await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND NOT blocked")).rows[0].n;
      assert.ok(active >= 1, `krog ${round}: ${codes}`);
      assert.equal(codes.filter((c) => c === 200).length, 1, `krog ${round}: ${codes}`);
      await pool.query("UPDATE users SET role = 'admin' WHERE email IN ('a1@example.com', 'a2@example.com')");
    }
  });
});

test('administrator ne vidi zasebnih strategij in testov uporabnikov (404, 403)', async () => {
  await withApp(async (base, pool) => {
    const { admin } = await setup(base, pool);
    const owner = await idOf(pool, 't@example.com');
    const privateStrategy = Number((await pool.query(
      "INSERT INTO strategies (owner_id, name, description, source, default_params, visibility) VALUES ($1, 'Zasebna', 'x', 'export default () => [];', '{}', 'private') RETURNING id", [owner])).rows[0].id);
    const strategy = (await pool.query('SELECT id FROM strategies WHERE owner_id IS NULL LIMIT 1')).rows[0].id;
    const test_ = Number((await pool.query(
      "INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results) VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-02', '{}', '{\"trades\": []}') RETURNING id", [owner, strategy])).rows[0].id);
    assert.equal((await send(base, 'GET', `/api/strategies/${privateStrategy}`, admin)).status, 404);
    assert.equal((await json(await send(base, 'GET', '/api/strategies', admin))).some((s: any) => s.id === privateStrategy), false);
    for (const path of [`/api/backtests/${test_}`, `/api/backtests/${test_}/trades`, '/api/backtests', '/api/strategy-catalog']) assert.equal((await send(base, 'GET', path, admin)).status, 403, path);
  });
});

test('upravljanje računov je samo za administratorja (403, 401)', async () => {
  await withApp(async (base, pool) => {
    const cookie = await setup(base, pool);
    const id = await idOf(pool, 't@example.com');
    for (const who of ['trader', 'mentor'] as const) {
      assert.equal((await send(base, 'GET', '/api/admin/users', cookie[who])).status, 403);
      assert.equal((await send(base, 'POST', '/api/admin/users', cookie[who], { name: 'X', email: 'x@y.si', password: 'geslo12345', role: 'admin' })).status, 403);
      assert.equal((await patch(base, cookie[who], id, { role: 'admin' })).status, 403);
    }
    assert.equal((await send(base, 'GET', '/api/admin/users')).status, 401);
    assert.equal((await pool.query('SELECT role FROM users WHERE id = $1', [id])).rows[0].role, 'trader');
  });
});
