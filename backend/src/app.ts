import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { CandleStore } from './candles.ts';

interface Deps {
  pool: Pool;
  store: CandleStore;
}
interface Result {
  status: number;
  body: unknown;
}
type Handler = (deps: Deps) => Promise<Result>;

const ok = (body: unknown): Result => ({ status: 200, body });

const select =
  (sql: string): Handler =>
  async ({ pool }) =>
    ok((await pool.query(sql)).rows);

// Sredstva z razponom podatkov (Parquet). Brez podatkov: candles 0, data_from/data_to null.
const instruments: Handler = async ({ pool, store }) => {
  const rows = (await pool.query('SELECT ticker, description, asset_class FROM instruments ORDER BY ticker')).rows;
  return ok(
    await Promise.all(
      rows.map(async (row) => {
        const range = await store.range(row.ticker);
        return {
          ...row,
          data_from: range?.from ?? null,
          data_to: range?.to ?? null,
          candles: range?.candles ?? 0,
        };
      }),
    ),
  );
};

// Pot -> metoda -> obravnava. Pot z drugo metodo vrne 405.
const routes: Record<string, Record<string, Handler>> = {
  '/api/health': { GET: async () => ok({ status: 'ok' }) },
  '/api/instruments': { GET: instruments },
  '/api/venues': { GET: select('SELECT id, name, maker_pct, taker_pct, pay_spread FROM venues ORDER BY id') },
  '/api/prop-plans': {
    GET: select(
      `SELECT id, firm_name, plan_name, account_size, max_daily_loss, max_total_loss, profit_target
       FROM prop_plans ORDER BY id`,
    ),
  },
};

export function createApp(pool: Pool, store: CandleStore): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    const methods = routes[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!methods) return send(404, { error: 'Not found' });
    const handler = methods[req.method ?? ''];
    if (!handler) return send(405, { error: 'Method not allowed' }, { Allow: Object.keys(methods).join(', ') });

    try {
      const result = await handler({ pool, store });
      send(result.status, result.body);
    } catch (err) {
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });
}
