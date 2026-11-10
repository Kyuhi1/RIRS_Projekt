import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { BacktestError, computeBacktest } from './backtest.ts';
import type { CandleStore } from './candles.ts';

const SELECT = `
  SELECT b.id, b.strategy_id, s.name AS strategy_name, b.venue_id,
         ARRAY(SELECT ticker FROM backtest_instruments WHERE backtest_id = b.id ORDER BY ticker) AS instruments,
         to_char(b.period_from, 'YYYY-MM-DD') AS "from", to_char(b.period_to, 'YYYY-MM-DD') AS "to",
         b.params, b.status, b.visibility, b.created_at`;
const FROM = 'FROM backtests b JOIN strategies s ON s.id = b.strategy_id';

const withId = <T extends { id: string; strategy_id: string }>({ id, strategy_id, ...rest }: T) => ({
  id: Number(id),
  strategy_id: Number(strategy_id),
  ...rest,
});

// Izračuna test in ga šele ob uspehu shrani v stanju draft (skupaj s sredstvi, v eni transakciji).
export async function createBacktest(pool: Pool, store: CandleStore, user: User, input: unknown): Promise<Result> {
  try {
    const test = await computeBacktest(pool, store, user, input);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user.id, test.strategyId, test.venueId, test.from, test.to, test.params, test.results],
      );
      const id = rows[0].id as string;
      await client.query('INSERT INTO backtest_instruments (backtest_id, ticker) SELECT $1, unnest($2::text[])', [id, test.instruments]);
      await client.query('COMMIT');
      return getBacktest(pool, user, id, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof BacktestError) return { status: err.status, body: err.body };
    throw err;
  }
}

// Seznam testov lastnika, najnovejši prvi, s povzetkom rezultatov (brez krivulje in poslov).
export async function listBacktests(pool: Pool, user: User): Promise<Result> {
  const { rows } = await pool.query(
    `${SELECT},
       jsonb_build_object('netProfit', b.results -> 'netProfit', 'returnPct', b.results -> 'returnPct',
         'tradeCount', b.results -> 'tradeCount', 'winRatePct', b.results -> 'winRatePct',
         'maxDrawdownPct', b.results -> 'maxDrawdownPct') AS summary
     ${FROM} WHERE b.owner_id = $1 ORDER BY b.id DESC`,
    [user.id],
  );
  return { status: 200, body: rows.map(withId) };
}

// Test vidi samo lastnik; tuj ali neobstoječ test vrne 404.
export async function getBacktest(pool: Pool, user: User, id: string, status = 200): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rows } = await pool.query(`${SELECT}, b.results ${FROM} WHERE b.id = $1 AND b.owner_id = $2`, [id, user.id]);
  return rows[0] ? { status, body: withId(rows[0]) } : { status: 404, body: { error: 'Test ne obstaja' } };
}
