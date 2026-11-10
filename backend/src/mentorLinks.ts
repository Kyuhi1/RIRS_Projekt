import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';

// Povezava mentor–trgovec (US-11). Stanja: invited -> active | declined, active -> ended.
// Mentor vidi svoje povezave, trgovec svoje; tuja povezava je kot neobstoječa (404).
const SELECT = `
  SELECT l.id, l.status, l.created_at, l.updated_at,
         jsonb_build_object('id', m.id::int, 'name', m.name) AS mentor,
         jsonb_build_object('id', t.id::int, 'name', t.name, 'email', t.email) AS trader
  FROM mentor_links l JOIN users m ON m.id = l.mentor_id JOIN users t ON t.id = l.trader_id`;

const NOT_FOUND: Result = { status: 404, body: { error: 'Povezava ne obstaja' } };
const present = ({ id, ...rest }: { id: string }) => ({ id: Number(id), ...rest });

interface Link {
  id: string;
  status: string;
  mentor_id: string;
  trader_id: string;
}

async function findLink(pool: Pool, user: User, id: string): Promise<Link | null> {
  if (!/^\d{1,15}$/.test(id)) return null;
  const { rows } = await pool.query<Link>('SELECT id, status, mentor_id, trader_id FROM mentor_links WHERE id = $1 AND (mentor_id = $2 OR trader_id = $2)', [id, user.id]);
  return rows[0] ?? null;
}

async function show(pool: Pool, id: string, status = 200): Promise<Result> {
  const { rows } = await pool.query(`${SELECT} WHERE l.id = $1`, [id]);
  return { status, body: present(rows[0]) };
}

// Povezave prijavljenega mentorja ali trgovca, najnovejše prve.
export async function listLinks(pool: Pool, user: User): Promise<Result> {
  const column = user.role === 'mentor' ? 'mentor_id' : 'trader_id';
  const { rows } = await pool.query(`${SELECT} WHERE l.${column} = $1 ORDER BY l.id DESC`, [user.id]);
  return { status: 200, body: rows.map(present) };
}

// Mentor povabi registriranega trgovca po e-naslovu. Neobstoječ uporabnik, uporabnik z drugo vlogo in
// blokiran uporabnik dajo isto sporočilo, da vabilo ne razkrije, kakšen račun ima e-naslov.
export async function invite(pool: Pool, user: User, input: unknown): Promise<Result> {
  const raw = typeof input === 'object' && input !== null ? (input as { email?: unknown }).email : undefined;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email) return { status: 400, body: { errors: { email: 'Vnesite e-naslov trgovca' } } };

  const trader = (await pool.query("SELECT id FROM users WHERE email = $1 AND role = 'trader' AND NOT blocked", [email])).rows[0];
  if (!trader) return { status: 400, body: { errors: { email: 'Registriran trgovec s tem e-naslovom ne obstaja' } } };

  const existing = (await pool.query('SELECT status FROM mentor_links WHERE mentor_id = $1 AND trader_id = $2', [user.id, trader.id])).rows[0];
  if (existing) return duplicate(existing.status);
  try {
    const { rows } = await pool.query('INSERT INTO mentor_links (mentor_id, trader_id) VALUES ($1, $2) RETURNING id', [user.id, trader.id]);
    return show(pool, String(rows[0].id), 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return duplicate('invited'); // sočasno drugo vabilo
    throw err;
  }
}

const DUPLICATE: Record<string, string> = {
  invited: 'Tega trgovca ste že povabili, odgovor še čaka',
  active: 'Ta trgovec je že vaš učenec',
  declined: 'Trgovec je vaše vabilo zavrnil, ponovno vabilo ni mogoče',
  ended: 'Povezava s tem trgovcem je bila prekinjena, ponovno vabilo ni mogoče',
};
const duplicate = (status: string): Result => ({ status: 409, body: { errors: { email: DUPLICATE[status] ?? DUPLICATE.invited } } });

const wrongState = (): Result => ({ status: 409, body: { error: 'Povezave v tem stanju ni mogoče spremeniti' } });

// Trgovec sprejme vabilo; z že aktivnim mentorjem ga ne more (to zagotavlja tudi delni enolični indeks).
export async function acceptLink(pool: Pool, user: User, id: string): Promise<Result> {
  const link = await findLink(pool, user, id);
  if (!link || Number(link.trader_id) !== user.id) return NOT_FOUND;
  if (link.status !== 'invited') return wrongState();
  try {
    const { rowCount } = await pool.query("UPDATE mentor_links SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'invited'", [link.id]);
    if (rowCount === 0) return wrongState();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return { status: 409, body: { error: 'Že imate aktivnega mentorja' } };
    throw err;
  }
  return show(pool, link.id);
}

export async function declineLink(pool: Pool, user: User, id: string): Promise<Result> {
  const link = await findLink(pool, user, id);
  if (!link || Number(link.trader_id) !== user.id) return NOT_FOUND;
  const { rowCount } = await pool.query("UPDATE mentor_links SET status = 'declined', updated_at = now() WHERE id = $1 AND status = 'invited'", [link.id]);
  return rowCount === 0 ? wrongState() : show(pool, link.id);
}

// Aktivno povezavo lahko prekine mentor ali trgovec; mentor potem ne vidi več učenčevih testov.
export async function endLink(pool: Pool, user: User, id: string): Promise<Result> {
  const link = await findLink(pool, user, id);
  if (!link) return NOT_FOUND;
  const { rowCount } = await pool.query("UPDATE mentor_links SET status = 'ended', updated_at = now() WHERE id = $1 AND status = 'active'", [link.id]);
  return rowCount === 0 ? wrongState() : show(pool, link.id);
}
