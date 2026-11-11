import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Pool } from 'pg';
import { login, logout, register, type Result, type User } from './auth.ts';
import { submitBacktest, withdrawBacktest } from './backtestReview.ts';
import { createBacktest, getBacktest, getTrades, listBacktests } from './backtestsApi.ts';
import type { CandleStore } from './candles.ts';
import { COOKIE_NAME, readCookie, verifyToken } from './session.ts';
import { acceptLink, declineLink, endLink, invite, listLinks } from './mentorLinks.ts';
import { createStrategy, deleteStrategy, getStrategy, listStrategies, updateStrategy } from './strategies.ts';

interface Deps {
  pool: Pool;
  store: CandleStore;
  jwtSecret: string;
  user: User | null; // prijavljeni uporabnik; pri javnih poteh null
  params: Record<string, string>; // deli poti, npr. :id
}
type Handler = (deps: Deps, req: IncomingMessage) => Promise<Result>;
type Role = User['role'];
interface Route {
  handle: Handler;
  roles?: Role[]; // če je podano, mora biti uporabnik prijavljen in imeti eno od teh vlog
}

class BadRequest extends Error {}
class BodyTooLarge extends BadRequest {}

// Strategije so lahko velike do 100 KB; telo ima rezervo za ubežne znake v JSON.
const STRATEGY_BODY_MAX = 512_000;

// Prebere telo zahtevka kot JSON (privzeto največ 10 KB). Preveliko telo se do 10 MB prebere in zavrže,
// da odjemalec dobi odgovor in ne prekinjene povezave; večje povezavo prekine.
const DRAIN_MAX = 10_000_000;
async function readJson(req: IncomingMessage, maxBytes = 10_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DRAIN_MAX) throw new BodyTooLarge();
    if (size <= maxBytes) chunks.push(chunk);
  }
  if (size > maxBytes) throw new BodyTooLarge();
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
  '/api/strategies': {
    GET: guarded(ANY_ROLE, async ({ pool, user }) => listStrategies(pool, user!)),
    POST: guarded(['trader'], async ({ pool, user }, req) => {
      try {
        return await createStrategy(pool, user!, await readJson(req, STRATEGY_BODY_MAX));
      } catch (err) {
        if (err instanceof BodyTooLarge) return { status: 400, body: { errors: { source: 'Datoteka je prevelika, dovoljenih je največ 100 KB' } } };
        throw err;
      }
    }),
  },
  '/api/strategies/:id': {
    GET: guarded(ANY_ROLE, async ({ pool, user, params }) => getStrategy(pool, user!, params.id!)),
    PATCH: guarded(['trader'], async ({ pool, user, params }, req) => {
      try {
        return await updateStrategy(pool, user!, params.id!, await readJson(req, STRATEGY_BODY_MAX));
      } catch (err) {
        if (err instanceof BodyTooLarge) return { status: 400, body: { errors: { source: 'Datoteka je prevelika, dovoljenih je največ 100 KB' } } };
        throw err;
      }
    }),
    DELETE: guarded(['trader'], async ({ pool, user, params }) => deleteStrategy(pool, user!, params.id!)),
  },
  '/api/backtests': {
    GET: guarded(['trader'], async ({ pool, user }) => listBacktests(pool, user!)),
    POST: guarded(['trader'], async ({ pool, store, user }, req) => createBacktest(pool, store, user!, await readJson(req))),
  },
  '/api/backtests/:id': { GET: guarded(['trader'], async ({ pool, user, params }) => getBacktest(pool, user!, params.id!)) },
  '/api/backtests/:id/submit': { POST: guarded(['trader'], async ({ pool, user, params }) => submitBacktest(pool, user!, params.id!)) },
  '/api/backtests/:id/withdraw': { POST: guarded(['trader'], async ({ pool, user, params }) => withdrawBacktest(pool, user!, params.id!)) },
  '/api/backtests/:id/trades': {
    GET: guarded(['trader'], async ({ pool, user, params }, req) =>
      getTrades(pool, user!, params.id!, new URL(req.url ?? '/', 'http://localhost').searchParams.get('page'))),
  },
  '/api/mentor-links': {
    GET: guarded(['mentor', 'trader'], async ({ pool, user }) => listLinks(pool, user!)),
    POST: guarded(['mentor'], async ({ pool, user }, req) => invite(pool, user!, await readJson(req))),
  },
  '/api/mentor-links/:id/accept': { POST: guarded(['trader'], async ({ pool, user, params }) => acceptLink(pool, user!, params.id!)) },
  '/api/mentor-links/:id/decline': { POST: guarded(['trader'], async ({ pool, user, params }) => declineLink(pool, user!, params.id!)) },
  '/api/mentor-links/:id/end': { POST: guarded(['mentor', 'trader'], async ({ pool, user, params }) => endLink(pool, user!, params.id!)) },
  '/api/admin/users': {
    GET: guarded(['admin'], select('SELECT id, email, name, role, blocked, created_at FROM users ORDER BY id')),
  },
};

// Poti z deli (:id) pretvorimo v regularne izraze; pot -> metode.
const compiled = Object.entries(routes).map(([pattern, methods]) => ({
  regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  methods,
}));

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

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = compiled.map((c) => ({ methods: c.methods, found: c.regex.exec(pathname) })).find((c) => c.found);
    if (!match) return send(404, { error: 'Not found' });
    const { methods } = match;
    const params = { ...match.found!.groups };
    const route = methods[req.method ?? ''];
    if (!route) return send(405, { error: 'Method not allowed' }, { Allow: Object.keys(methods).join(', ') });

    try {
      const user = await currentUser(pool, jwtSecret, req);
      if (route.roles) {
        if (!user) return send(401, { error: 'Prijava je obvezna' });
        if (!route.roles.includes(user.role)) return send(403, { error: 'Dostop ni dovoljen' });
      }
      const result = await route.handle({ pool, store, jwtSecret, user, params }, req);
      send(result.status, result.body, result.headers);
    } catch (err) {
      if (err instanceof BadRequest) return send(400, { error: 'Neveljavna zahteva' });
      console.error(err);
      send(500, { error: 'Internal server error' });
    }
  });
}
