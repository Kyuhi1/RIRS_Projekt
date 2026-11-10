import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { migrate } from './migrate.ts';
import { addUser } from './testApp.ts';
import { withTestDb } from './testDb.ts';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));

async function setup(pool: Pool) {
  await migrate(pool, MIGRATIONS);
  await addUser(pool, 'trader');
  const owner = (await pool.query('SELECT id FROM users')).rows[0].id as string;
  const strategy = (await pool.query("SELECT id FROM strategies WHERE name = 'Buy & Hold'")).rows[0].id as string;
  const insert = (extra = '', from = '2024-01-01', to = '2024-01-31') =>
    pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results${extra ? ', status' : ''})
       VALUES ($1, $2, 'gross', $3, $4, '{}'${extra ? `, '${extra}'` : ''}) RETURNING id, status, visibility, params`,
      [owner, strategy, from, to],
    );
  return { insert };
}

test('nov test je privzeto v stanju draft, zaseben in z praznimi parametri', async () => {
  await withTestDb(async (pool) => {
    const { insert } = await setup(pool);
    const row = (await insert()).rows[0];
    assert.deepEqual([row.status, row.visibility, row.params], ['draft', 'private', {}]);
  });
});

test('neveljavno stanje in obrnjeno obdobje sta zavrnjena', async () => {
  await withTestDb(async (pool) => {
    const { insert } = await setup(pool);
    await assert.rejects(insert('finished'), /check constraint/);
    await assert.rejects(insert('', '2024-02-01', '2024-01-01'), /check constraint/);
    await assert.rejects(insert('', '2024-01-01', '2024-01-01'), /check constraint/);
  });
});

test('sredstva testa: par (test, sredstvo) je enoličen, neznano sredstvo ni dovoljeno, brisanje testa odstrani sredstva', async () => {
  await withTestDb(async (pool) => {
    const { insert } = await setup(pool);
    const id = (await insert()).rows[0].id as string;
    await pool.query("INSERT INTO backtest_instruments VALUES ($1, 'BTCUSDT'), ($1, 'ETHUSDT')", [id]);
    await assert.rejects(pool.query("INSERT INTO backtest_instruments VALUES ($1, 'BTCUSDT')", [id]), /duplicate key/);
    await assert.rejects(pool.query("INSERT INTO backtest_instruments VALUES ($1, 'NEOBSTAJA')", [id]), /foreign key/);

    await pool.query('DELETE FROM backtests WHERE id = $1', [id]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM backtest_instruments')).rows[0].n, 0);
  });
});

test('strategije, borze in sredstva, ki jih test uporablja, ni mogoče izbrisati', async () => {
  await withTestDb(async (pool) => {
    const { insert } = await setup(pool);
    const id = (await insert()).rows[0].id as string;
    await pool.query("INSERT INTO backtest_instruments VALUES ($1, 'BTCUSDT')", [id]);
    await assert.rejects(pool.query("DELETE FROM venues WHERE id = 'gross'"), /foreign key/);
    await assert.rejects(pool.query("DELETE FROM instruments WHERE ticker = 'BTCUSDT'"), /foreign key/);
    await assert.rejects(pool.query("DELETE FROM strategies WHERE name = 'Buy & Hold'"), /foreign key/);
  });
});
