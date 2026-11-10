import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Pool } from 'pg';
import { login, logout, register, type Result, type User } from './auth.ts';
import type { CandleStore } from './candles.ts';
import { COOKIE_NAME, readCookie, verifyToken } from './session.ts';

interface Deps {
  pool: Pool;
  store: CandleStore;
  jwtSecret: string;
  user: User | null; // prijavljeni uporabnik; pri javnih poteh null
}
type Handler = (deps: Deps, req: IncomingMessage) => Promise<Result>;
type Role = User['role'];
interface Route {
  handle: Handler;
  roles?: Role[]; // če je podano, mora biti uporabnik prijavljen in imeti eno od teh vlog
}

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

const open = (handle: Handler): Route => ({ handle });
const guarded = (roles: Role[], handle: Handler): Route => ({ roles, handle });
const ANY_ROLE: Role[] = ['trader', 'mentor', 'admin'];

// Pot -> metoda -> pot z obravnavo. Pot z drugo metodo vrne 405.
const routes: Record<string, Record<string, Route>> = {
  '/api/health': { GET: open(async () => ok({ status: 'ok' })) },
  '/api/instruments': { GET: guarded(ANY_ROLE, instruments) },
  '/api/venues': { GET: guarded(ANY_ROLE, select('SELECT id, name, maker_pct, taker_pct, pay_spread FROM venues ORDER BY id')) },
  '/api/prop-plans': {
    GET: guarded(
      ANY_ROLE,
      select(
        `SELECT id, firm_name, plan_name, account_size, max_daily_loss, max_total_loss, profit_target
         FROM prop_plans ORDER BY id`,
      ),
    ),
  },
  '/api/auth/register': { POST: open(async ({ pool }, req) => register(pool, await readJson(req))) },
  '/api/auth/login': { POST: open(async ({ pool, jwtSecret }, req) => login(pool, jwtSecret, await readJson(req))) },
  '/api/auth/logout': { POST: open(async () => logout()) },
  '/api/auth/me': { GET: guarded(ANY_ROLE, async ({ user }) => ok(user)) },
  '/api/admin/users': {
    GET: guarded(['admin'], select('SELECT id, email, name, role, blocked, created_at FROM users ORDER BY id')),
  },
};

// Uporabnika preberemo iz piškotka in ga ob vsakem zahtevku preverimo v bazi (vloga, blocked).
async function currentUser(pool: Pool, jwtSecret: string, req: IncomingMessage): Promise<User | null> {
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  const id = token ? await verifyToken(jwtSecret, token) : null;
  if (id === null) return null;
  const row = (await pool.query('SELECT id, email, name, role, blocked FROM users WHERE id = $1', [id])).rows[0];
  if (!row || row.blocked) return null;
  return { id: Number(row.id), email: row.email, name: row.name, role: row.role };
}

export function createApp(pool: Pool, store: CandleStore, jwtSecret: string): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    const methods = routes[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!methods) return send(404, { error: 'Not found' });
    const route = methods[req.method ?? ''];
    if (!route) return send(405, { error: 'Method not allowed' }, { Allow: Object.keys(methods).join(', ') });

    try {
      const user = await currentUser(pool, jwtSecret, req);
      if (route.roles) {
        if (!user) return send(401, { error: 'Prijava je obvezna' });
        if (!route.roles.includes(user.role)) return send(403, { error: 'Dostop ni dovoljen' });
      }
      const result = await route.handle({ pool, store, jwtSecret, user }, req);
      send(result.status, result.body, result.headers);
    } catch (err) {
      if (err instanceof BadRequest) return send(400, { error: 'Neveljavna zahteva' });
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });
}
