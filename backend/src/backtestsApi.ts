import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { BacktestError, computeBacktest } from './backtest.ts';
import type { CandleStore } from './candles.ts';

const SELECT = `
  SELECT b.id, b.strategy_id, s.name AS strategy_name, b.venue_id,
         ARRAY(SELECT ticker FROM backtest_instruments WHERE backtest_id = b.id ORDER BY ticker) AS instruments,
         to_char(b.period_from, 'YYYY-MM-DD') AS "from", to_char(b.period_to, 'YYYY-MM-DD') AS "to",
         b.params, b.status, b.visibility, b.created_at, b.challenge_passed,
         (SELECT jsonb_build_object('id', u.id::int, 'name', u.name) FROM users u WHERE u.id = b.reviewer_id) AS reviewer,
         CASE WHEN pp.id IS NULL THEN NULL ELSE jsonb_build_object('id', pp.id, 'firm_name', pp.firm_name, 'plan_name', pp.plan_name,
           'account_size', pp.account_size, 'profit_target', pp.profit_target,
           'max_daily_loss', pp.max_daily_loss, 'max_total_loss', pp.max_total_loss) END AS prop_plan`;
const FROM = 'FROM backtests b JOIN strategies s ON s.id = b.strategy_id LEFT JOIN prop_plans pp ON pp.id = b.prop_plan_id';

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
        `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, prop_plan_id, challenge_passed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [user.id, test.strategyId, test.venueId, test.from, test.to, test.params, test.results, test.propPlanId, test.challengePassed],
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
// Posli niso del odgovora (lahko jih je veliko); dobi jih `getTrades` po straneh.
export async function getBacktest(pool: Pool, user: User, id: string, status = 200): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rows } = await pool.query(`${SELECT}, b.results - 'trades' AS results,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'changed_at', h.changed_at,
                   'changed_by', jsonb_build_object('id', c.id::int, 'name', c.name)) ORDER BY h.id)
                 FROM status_history h JOIN users c ON c.id = h.changed_by WHERE h.backtest_id = b.id), '[]'::jsonb) AS history
     ${FROM} WHERE b.id = $1 AND b.owner_id = $2`, [id, user.id]);
  return rows[0] ? { status, body: withId(rows[0]) } : { status: 404, body: { error: 'Test ne obstaja' } };
}

export const TRADES_PAGE_SIZE = 20;

// Posli testa, razvrščeni po času vstopa (pri enakem času po vrstnem redu izračuna), po 20 na stran.
// `page` je celo število od 1 naprej; stran za zadnjo je veljavna in vrne prazen seznam.
export async function getTrades(pool: Pool, user: User, id: string, page: string | null): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  if (page !== null && !/^[1-9]\d{0,8}$/.test(page)) return { status: 400, body: { errors: { page: 'Stran mora biti celo število od 1 naprej' } } };
  const number = page === null ? 1 : Number(page);
  const { rows } = await pool.query(
    `SELECT jsonb_array_length(b.results -> 'trades') AS total,
            ARRAY(SELECT x.t FROM jsonb_array_elements(b.results -> 'trades') WITH ORDINALITY AS x(t, n)
                  ORDER BY (x.t ->> 'entryTime')::bigint, x.n OFFSET $3 LIMIT $4) AS trades
     FROM backtests b WHERE b.id = $1 AND b.owner_id = $2`,
    [id, user.id, (number - 1) * TRADES_PAGE_SIZE, TRADES_PAGE_SIZE],
  );
  if (!rows[0]) return { status: 404, body: { error: 'Test ne obstaja' } };
  const total = rows[0].total as number;
  return { status: 200, body: { page: number, pageSize: TRADES_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / TRADES_PAGE_SIZE)), trades: rows[0].trades } };
}
