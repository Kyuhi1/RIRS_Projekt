import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { ensureAdmin } from './auth.ts';
import { addUser, loginCookie, PASSWORD, withApp } from './testApp.ts';

const PROTECTED = ['/api/instruments', '/api/venues', '/api/prop-plans', '/api/auth/me', '/api/admin/users'];

test('brez prijave zaščitene poti vrnejo 401, javne pa delujejo', async () => {
  await withApp(async (base) => {
    for (const path of PROTECTED) {
      const res = await fetch(base + path);
      assert.equal(res.status, 401, path);
      assert.deepEqual(await res.json(), { error: 'Prijava je obvezna' });
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('vloge: trgovec in mentor dobita 403 na admin poti, admin jo vidi; skupne poti so dostopne vsem', async () => {
  await withApp(async (base, pool) => {
    for (const role of ['trader', 'mentor', 'admin']) {
      const cookie = await loginCookie(base, await addUser(pool, role));
      const headers = { Cookie: cookie };

      const users = await fetch(`${base}/api/admin/users`, { headers });
      if (role === 'admin') {
        assert.equal(users.status, 200);
        const list = (await users.json()) as Record<string, unknown>[];
        assert.equal(list.length, 3);
        assert.ok(list.every((u) => !('password_hash' in u)));
      } else {
        assert.equal(users.status, 403, role);
        assert.deepEqual(await users.json(), { error: 'Dostop ni dovoljen' });
      }
      for (const path of ['/api/venues', '/api/prop-plans', '/api/instruments']) {
        assert.equal((await fetch(base + path, { headers })).status, 200, `${role} ${path}`);
      }
    }
  });
});

test('po odjavi (piškotek izbrisan) zaščitene poti niso več dostopne', async () => {
  await withApp(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader'));
    assert.equal((await fetch(`${base}/api/venues`, { headers: { Cookie: cookie } })).status, 200);

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    const cleared = out.headers.get('set-cookie')!.split(';')[0]!; // brskalnik zamenja piškotek s tem
    assert.equal((await fetch(`${base}/api/venues`, { headers: { Cookie: cleared } })).status, 401);
  });
});

test('ensureAdmin ustvari admina, je idempotenten in obstoječemu računu ohrani geslo', async () => {
  await withApp(async (base, pool) => {
    assert.equal(await ensureAdmin(pool, undefined, undefined), 'skipped');
    assert.equal(await ensureAdmin(pool, 'Admin@Example.com', 'adminGeslo1'), 'created');
    assert.equal(await ensureAdmin(pool, 'admin@example.com', 'adminGeslo1'), 'updated');

    const rows = (await pool.query('SELECT * FROM users')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, 'admin');
    assert.ok(await bcrypt.compare('adminGeslo1', rows[0].password_hash));

    const cookie = await loginCookie(base, 'admin@example.com', 'adminGeslo1');
    assert.equal((await fetch(`${base}/api/admin/users`, { headers: { Cookie: cookie } })).status, 200);

    // trgovec z istim e-naslovom postane admin, geslo ostane
    await pool.query('DELETE FROM users');
    await addUser(pool, 'trader', 'admin@example.com', true);
    assert.equal(await ensureAdmin(pool, 'admin@example.com', 'drugoGeslo99'), 'updated');
    const row = (await pool.query('SELECT role, blocked FROM users')).rows[0];
    assert.deepEqual(row, { role: 'admin', blocked: false });
    assert.equal((await loginCookie(base, 'admin@example.com', PASSWORD)).startsWith('token='), true);

    await assert.rejects(ensureAdmin(pool, 'ni-email', 'adminGeslo1'), /ADMIN_EMAIL/);
    await assert.rejects(ensureAdmin(pool, 'a@example.com', 'kratko'), /ADMIN_PASSWORD/);
  });
});
