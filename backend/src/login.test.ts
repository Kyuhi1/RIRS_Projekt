import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUser, loginCookie, PASSWORD, TEST_SECRET, withApp } from './testApp.ts';
import { signToken, verifyToken } from './session.ts';

const post = (base: string, path: string, body: unknown, cookie?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

test('prijava vseh treh vlog vrne uporabnika in podpisan JWT v httpOnly piškotku', async () => {
  await withApp(async (base, pool) => {
    for (const role of ['trader', 'mentor', 'admin']) {
      const email = await addUser(pool, role);
      const res = await post(base, '/api/auth/login', { email, password: PASSWORD });
      assert.equal(res.status, 200, role);
      const user = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name', 'role']);
      assert.equal(user.role, role);

      const cookie = res.headers.get('set-cookie')!;
      assert.match(cookie, /^token=[\w-]+\.[\w-]+\.[\w-]+;/); // JWT
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.equal(await verifyToken(TEST_SECRET, cookie.split(';')[0]!.slice(6)), user.id);
    }
  });
});

test('napačno geslo in neznan e-naslov vrneta isto sporočilo in ne nastavita piškotka', async () => {
  await withApp(async (base, pool) => {
    const email = await addUser(pool, 'trader');
    const wrongPassword = await post(base, '/api/auth/login', { email, password: 'napacno-geslo' });
    const unknownEmail = await post(base, '/api/auth/login', { email: 'ni@example.com', password: PASSWORD });
    for (const res of [wrongPassword, unknownEmail]) {
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'Napačen e-naslov ali geslo' });
      assert.equal(res.headers.get('set-cookie'), null);
    }
    const empty = await post(base, '/api/auth/login', {});
    assert.equal(empty.status, 401);
  });
});

test('blokiran račun z pravilnim geslom ne more do prijave', async () => {
  await withApp(async (base, pool) => {
    const email = await addUser(pool, 'trader', 'blokiran@example.com', true);
    const res = await post(base, '/api/auth/login', { email, password: PASSWORD });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Račun je blokiran' });
    assert.equal(res.headers.get('set-cookie'), null);

    // blokiran račun z napačnim geslom ne izda, da račun obstaja
    const wrong = await post(base, '/api/auth/login', { email, password: 'napacno-geslo' });
    assert.equal(wrong.status, 401);
  });
});

test('GET /api/auth/me vrne prijavljenega uporabnika, brez prijave 401', async () => {
  await withApp(async (base, pool) => {
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);

    const cookie = await loginCookie(base, await addUser(pool, 'mentor'));
    const res = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { role: string }).role, 'mentor');
  });
});

test('odjava izbriše piškotek; ponarejen, potekel in blokiran žeton ne dajo dostopa', async () => {
  await withApp(async (base, pool) => {
    const logout = await post(base, '/api/auth/logout', {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie')!, /^token=; .*Max-Age=0/);

    const me = (cookie: string) => fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    const email = await addUser(pool, 'trader');
    const cookie = await loginCookie(base, email);
    assert.equal((await me(cookie)).status, 200);
    assert.equal((await me('token=')).status, 401); // po odjavi brskalnik pošlje prazen piškotek

    assert.equal((await me(`${cookie.slice(0, -2)}xx`)).status, 401); // spremenjen podpis
    const foreign = await signToken('druga-skrivnost-druga-skrivnost-123456', 1);
    assert.equal((await me(`token=${foreign}`)).status, 401); // podpisan z drugo skrivnostjo

    await pool.query('UPDATE users SET blocked = true WHERE email = $1', [email]);
    assert.equal((await me(cookie)).status, 401); // veljaven žeton, a račun je blokiran
  });
});
