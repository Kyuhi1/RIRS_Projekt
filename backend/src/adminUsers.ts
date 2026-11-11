import type { Pool } from 'pg';
import { ALL_ROLES, createUser, type Result, type User } from './auth.ts';

// Upravljanje uporabniških računov (US-17). Blokada in vloga veljata takoj, ker backend uporabnika ob vsakem
// zahtevku prebere iz baze (blokiran uporabnik z obstoječim žetonom dobi 401, nova vloga velja od naslednjega zahtevka).
export const USERS_PAGE_SIZE = 20;
const COLUMNS = 'id::int AS id, email, name, role, blocked, created_at';

// Seznam po 20, po imenu in e-naslovu (`q`, brez razlikovanja velikosti, % in _ dobesedno), razvrščen po id.
export async function listUsers(pool: Pool, q: string | null, page: string | null): Promise<Result> {
  if (page !== null && !/^[1-9]\d{0,8}$/.test(page)) return { status: 400, body: { errors: { page: 'Stran mora biti celo število od 1 naprej' } } };
  const number = page === null ? 1 : Number(page);
  const search = (q ?? '').trim();
  const where = `($1 = '' OR concat_ws(' ', name, email) ILIKE '%' || replace(replace(replace($1, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
  const { rows } = await pool.query(`SELECT ${COLUMNS}, count(*) OVER ()::int AS total FROM users WHERE ${where} ORDER BY id OFFSET $2 LIMIT $3`,
    [search, (number - 1) * USERS_PAGE_SIZE, USERS_PAGE_SIZE]);
  const total = rows[0]?.total ?? (number === 1 ? 0 : (await pool.query(`SELECT count(*)::int AS n FROM users WHERE ${where}`, [search])).rows[0].n);
  return {
    status: 200,
    body: { page: number, pageSize: USERS_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)), items: rows.map(({ total: _total, ...user }) => user) },
  };
}

// Administrator ustvari račun z imenom, e-naslovom, geslom in vlogo (tudi admin).
export const createAccount = (pool: Pool, input: unknown): Promise<Result> => createUser(pool, input, ALL_ROLES);

// Spremeni ime, vlogo in/ali blokado (PATCH). Zaščite (409 z razlogom): administrator ne more blokirati samega sebe
// in nihče ne more odvzeti vloge ali blokirati zadnjega aktivnega administratorja. Administratorji se zaklenejo v stalnem
// vrstnem redu, da dva sočasna odvzema ne moreta oba uspeti.
export async function updateUser(pool: Pool, actor: User, rawId: string, input: unknown): Promise<Result> {
  if (!/^\d{1,15}$/.test(rawId)) return { status: 404, body: { error: 'Uporabnik ne obstaja' } };
  const id = Number(rawId);
  const body = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (body.name !== undefined && !name) errors.name = 'Vnesite ime in priimek';
  if (body.role !== undefined && (typeof body.role !== 'string' || !ALL_ROLES.includes(body.role))) errors.role = 'Vloga mora biti trader, mentor ali admin';
  if (body.blocked !== undefined && typeof body.blocked !== 'boolean') errors.blocked = 'Blokiran mora biti da ali ne';
  if (Object.keys(errors).length === 0 && name === undefined && body.role === undefined && body.blocked === undefined) errors.body = 'Podajte ime, vlogo ali blokado';
  if (Object.keys(errors).length > 0) return { status: 400, body: { errors } };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const admins = (await client.query("SELECT id::int AS id, blocked FROM users WHERE role = 'admin' OR id = $1 ORDER BY id FOR UPDATE", [id])).rows;
    const target = (await client.query('SELECT id::int AS id, role, blocked FROM users WHERE id = $1', [id])).rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Uporabnik ne obstaja' } };
    }
    const role = (body.role as string | undefined) ?? target.role;
    const blocked = (body.blocked as boolean | undefined) ?? target.blocked;
    const refuse = async (error: string): Promise<Result> => {
      await client.query('ROLLBACK');
      return { status: 409, body: { error } };
    };
    if (id === actor.id && blocked && !target.blocked) return refuse('Sebe ne morete blokirati');
    const staysActiveAdmin = role === 'admin' && !blocked;
    const wasActiveAdmin = target.role === 'admin' && !target.blocked;
    if (wasActiveAdmin && !staysActiveAdmin) {
      const others = admins.filter((a) => a.id !== id && !a.blocked).length;
      if (others === 0) return refuse(role !== 'admin' ? 'Vloge administrator ni mogoče odvzeti zadnjemu administratorju' : 'Zadnjega administratorja ni mogoče blokirati');
    }
    const { rows } = await client.query(
      `UPDATE users SET name = COALESCE($2, name), role = $3, blocked = $4 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, name ?? null, role, blocked],
    );
    await client.query('COMMIT');
    return { status: 200, body: rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
