import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Ustvari začasno bazo, požene funkcijo in bazo izbriše (tudi ob napaki).
export async function withTestDb(fn: (pool: pg.Pool) => Promise<void>): Promise<void> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL ni nastavljen');

  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
}
