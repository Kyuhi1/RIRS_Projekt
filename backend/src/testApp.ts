import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { createApp } from './app.ts';
import { createCandleStore } from './candles.ts';
import { migrate } from './migrate.ts';
import { withTestDb } from './testDb.ts';

export const TEST_SECRET = 'testna-skrivnost-za-jwt-najmanj-32-znakov';
const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));

export const PASSWORD = 'geslo1234';

// Zažene aplikacijo nad začasno bazo z migracijami in jo po testu ugasne.
export async function withApp(fn: (base: string, pool: Pool) => Promise<void>): Promise<void> {
  await withTestDb(async (pool) => {
    await migrate(pool, MIGRATIONS);
    const server = createApp(pool, createCandleStore('/ni-podatkov'), TEST_SECRET).listen(0);
    await once(server, 'listening');
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, pool);
    } finally {
      server.close();
    }
  });
}

// Ustvari uporabnika z geslom PASSWORD (hitro zgoščevanje samo za teste).
export async function addUser(pool: Pool, role: string, email = `${role}@example.com`, blocked = false) {
  await pool.query('INSERT INTO users (email, name, password_hash, role, blocked) VALUES ($1, $2, $3, $4, $5)', [
    email,
    `Test ${role}`,
    await bcrypt.hash(PASSWORD, 4),
    role,
    blocked,
  ]);
  return email;
}

// Prijavi uporabnika in vrne vrednost za glavo Cookie.
export async function loginCookie(base: string, email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`prijava ni uspela: ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}
