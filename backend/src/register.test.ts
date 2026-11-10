import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { createApp } from './app.ts';
import { TEST_SECRET } from './testApp.ts';
import { createCandleStore } from './candles.ts';
import { migrate } from './migrate.ts';
import { withTestDb } from './testDb.ts';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const VALID = { name: 'Ana Novak', email: 'ana@example.com', password: 'geslo1234', role: 'trader' };

// Zažene aplikacijo nad začasno bazo z migracijami; post() pošlje JSON na /api/auth/register.
async function withApp(fn: (post: (body: unknown) => Promise<Response>, pool: Pool) => Promise<void>) {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const server = createApp(pool, createCandleStore('/ni-podatkov'), TEST_SECRET).listen(0);
    await once(server, 'listening');
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/register`;
      await fn(
        (body) =>
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
        pool,
      );
    } finally {
      server.close();
    }
  });
}

const countUsers = async (pool: Pool) => (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;

test('uspešna registracija zapiše uporabnika z blocked = false in bcrypt zgoščenim geslom', async () => {
  await withApp(async (post, pool) => {
    const res = await post(VALID);
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['email', 'id', 'name', 'role']); // brez password_hash

    const row = (await pool.query('SELECT * FROM users')).rows[0];
    assert.equal(row.email, 'ana@example.com');
    assert.equal(row.name, 'Ana Novak');
    assert.equal(row.role, 'trader');
    assert.equal(row.blocked, false);
    assert.notEqual(row.password_hash, VALID.password);
    assert.match(row.password_hash, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(VALID.password, row.password_hash), true);
  });
});

test('mentor se lahko registrira', async () => {
  await withApp(async (post, pool) => {
    assert.equal((await post({ ...VALID, role: 'mentor' })).status, 201);
    assert.equal((await pool.query('SELECT role FROM users')).rows[0].role, 'mentor');
  });
});

test('neveljavni podatki vrnejo napako ob polju in ne ustvarijo računa', async () => {
  await withApp(async (post, pool) => {
    const cases: [object, string][] = [
      [{ ...VALID, email: 'ni-email' }, 'email'],
      [{ ...VALID, password: '1234567' }, 'password'], // 7 znakov
      [{ ...VALID, name: '   ' }, 'name'],
      [{ ...VALID, role: 'ni-vloga' }, 'role'],
    ];
    for (const [body, field] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, field);
      const { errors } = (await res.json()) as { errors: Record<string, string> };
      assert.deepEqual(Object.keys(errors), [field]);
    }
    assert.equal(await countUsers(pool), 0);
  });
});

test('vloge administrator ni mogoče izbrati niti z neposrednim klicem API-ja', async () => {
  await withApp(async (post, pool) => {
    const res = await post({ ...VALID, role: 'admin' });
    assert.equal(res.status, 400);
    assert.ok(((await res.json()) as { errors: Record<string, string> }).errors.role);
    assert.equal(await countUsers(pool), 0);
  });
});

test('obstoječ e-naslov vrne sporočilo in ne ustvari novega zapisa', async () => {
  await withApp(async (post, pool) => {
    assert.equal((await post(VALID)).status, 201);
    // enak e-naslov, tudi z drugačnimi velikimi črkami
    const res = await post({ ...VALID, name: 'Druga Oseba', email: 'ANA@example.com' });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { errors: { email: 'Račun s tem e-naslovom že obstaja' } });
    assert.equal(await countUsers(pool), 1);
  });
});

test('telo, ki ni veljaven JSON, vrne 400', async () => {
  await withApp(async (post, pool) => {
    assert.equal((await post('to ni json')).status, 400);
    assert.equal(await countUsers(pool), 0);
  });
});
