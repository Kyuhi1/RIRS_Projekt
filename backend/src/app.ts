import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';

type Handler = (pool: Pool) => Promise<unknown>;

const select = (sql: string): Handler => async (pool) => (await pool.query(sql)).rows;

// Vse poti so samo za branje (GET).
const routes: Record<string, Handler> = {
  '/api/health': async () => ({ status: 'ok' }),
  '/api/instruments': select('SELECT ticker, description, asset_class FROM instruments ORDER BY ticker'),
  '/api/venues': select('SELECT id, name, maker_pct, taker_pct, pay_spread FROM venues ORDER BY id'),
  '/api/prop-plans': select(
    `SELECT id, firm_name, plan_name, account_size, max_daily_loss, max_total_loss, profit_target
     FROM prop_plans ORDER BY id`,
  ),
};

export function createApp(pool: Pool): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    const handler = routes[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!handler) return send(404, { error: 'Not found' });
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed' }, { Allow: 'GET' });

    try {
      send(200, await handler(pool));
    } catch (err) {
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });
}
