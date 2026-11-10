import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrate } from './migrate.ts';
import { withTestDb } from './testDb.ts';

async function makeMigrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql);
  }
  return dir;
}

test('migracije se izvedejo po vrsti in samo enkrat', async () => {
  // 002 je zapisana pred 001, da preverimo razvrščanje po imenu
  const dir = await makeMigrationsDir({
    '002_second.sql': "INSERT INTO items (v) VALUES ('b');",
    '001_first.sql': "CREATE TABLE items (v text); INSERT INTO items (v) VALUES ('a');",
  });
  try {
    await withTestDb(async (pool) => {
      assert.deepEqual(await migrate(pool, dir), ['001_first.sql', '002_second.sql']);
      const rows = await pool.query('SELECT v FROM items');
      assert.deepEqual(rows.rows.map((r) => r.v), ['a', 'b']);

      // ponoven zagon ne naredi ničesar (CREATE TABLE bi sicer padel)
      assert.deepEqual(await migrate(pool, dir), []);
      const count = await pool.query('SELECT count(*)::int AS n FROM items');
      assert.equal(count.rows[0].n, 2);
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('nova migracija se izvede, stare pa ne', async () => {
  const dir = await makeMigrationsDir({
    '001_first.sql': 'CREATE TABLE items (v text);',
  });
  try {
    await withTestDb(async (pool) => {
      await migrate(pool, dir);
      await writeFile(join(dir, '002_second.sql'), 'ALTER TABLE items ADD COLUMN extra text;');
      assert.deepEqual(await migrate(pool, dir), ['002_second.sql']);
      const names = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
      assert.deepEqual(names.rows.map((r) => r.name), ['001_first.sql', '002_second.sql']);
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});
