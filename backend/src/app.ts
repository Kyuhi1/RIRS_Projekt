import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Pool } from 'pg';
import { register, type Result } from './auth.ts';
import type { CandleStore } from './candles.ts';

interface Deps {
  pool: Pool;
  store: CandleStore;
}
type Handler = (deps: Deps, req: IncomingMessage) => Promise<Result>;

class BadRequest extends Error {}

// Prebere telo zahtevka kot JSON (največ 10 KB).
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new BadRequest();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest();
  }
}

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
  '/api/auth/register': { POST: async ({ pool }, req) => register(pool, await readJson(req)) },
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
      const result = await handler({ pool, store }, req);
      send(result.status, result.body);
    } catch (err) {
      if (err instanceof BadRequest) return send(400, { error: 'Neveljavna zahteva' });
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });
}
