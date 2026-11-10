import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

// Po vrsti (po imenu datoteke) izvede SQL migracije, ki še niso zabeležene
// v schema_migrations. Vsaka migracija teče v svoji transakciji.
export async function migrate(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const doneNames = new Set(done.rows.map((r) => r.name));

  const applied: string[] = [];
  for (const file of files) {
    if (doneNames.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migracija ${file} ni uspela: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
