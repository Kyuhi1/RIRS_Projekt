import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { validateNewStrategy } from './strategyUpload.ts';

// Strategije, ki jih uporabnik sme videti: sistemske (brez lastnika), njegove in deljene strategije drugih.
// Zasebnih strategij drugih uporabnikov ni mogoče videti (P1).
const VISIBLE = `(s.owner_id IS NULL OR s.owner_id = $1 OR s.visibility = 'shared')`;
const COLUMNS = `s.id, s.name, s.description, s.visibility, s.owner_id IS NULL AS system, s.owner_id = $1 AS mine,
  COALESCE(u.name, 'Sistem') AS author`;
const FROM = 'FROM strategies s LEFT JOIN users u ON u.id = s.owner_id';

interface Row {
  id: string;
  system: boolean;
  mine: boolean | null;
  [key: string]: unknown;
}

const present = ({ id, mine, ...rest }: Row) => ({ id: Number(id), ...rest, mine: mine === true });

export async function listStrategies(pool: Pool, user: User): Promise<Result> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} ${FROM} WHERE ${VISIBLE} ORDER BY s.owner_id IS NOT NULL, s.id`,
    [user.id],
  );
  return { status: 200, body: rows.map(present) };
}

export async function getStrategy(pool: Pool, user: User, id: string, status = 200): Promise<Result> {
  const notFound: Result = { status: 404, body: { error: 'Strategija ne obstaja' } };
  if (!/^\d{1,15}$/.test(id)) return notFound;

  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS}, s.source, s.default_params, s.created_at ${FROM} WHERE s.id = $2 AND ${VISIBLE}`,
    [user.id, id],
  );
  return rows[0] ? { status, body: present(rows[0]) } : notFound; // tuja zasebna strategija se ne razlikuje od neobstoječe
}

// Nova strategija je vedno zasebna in last prijavljenega trgovca; deljenje ni del te funkcionalnosti.
export async function createStrategy(pool: Pool, user: User, input: unknown): Promise<Result> {
  const checked = validateNewStrategy(input);
  if (!checked.ok) return { status: 400, body: { errors: checked.errors } };
  const { name, description, source, defaultParams } = checked.value;
  const { rows } = await pool.query(
    `INSERT INTO strategies (owner_id, name, description, source, default_params, visibility)
     VALUES ($1, $2, $3, $4, $5, 'private') RETURNING id`,
    [user.id, name, description, source, defaultParams],
  );
  return getStrategy(pool, user, String(rows[0].id), 201);
}
