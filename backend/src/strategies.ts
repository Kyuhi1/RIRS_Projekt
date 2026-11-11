import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { checkDefaultParams, checkDescription, checkName, checkSource, validateNewStrategy, type FieldErrors } from './strategyUpload.ts';

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

export const CATALOG_PAGE_SIZE = 20;
export const SEARCH_MIN_LENGTH = 3;
export const SOURCES = ['all', 'mine', 'system', 'shared'] as const;

// Pogoj za izvor: Moje (lastnik sem jaz), Sistemske (brez lastnika), Deljene (strategije uporabnikov z vidnostjo shared).
const SOURCE_FILTERS: Record<(typeof SOURCES)[number], string> = {
  all: 'TRUE',
  mine: 's.owner_id = $1',
  system: 's.owner_id IS NULL',
  shared: "(s.owner_id IS NOT NULL AND s.visibility = 'shared')",
};

// Katalog strategij (US-03): vidne strategije po izvoru, z iskanjem po imenu in paginacijo po 20. Iskanje se uporabi
// šele pri vsaj 3 znakih (krajše besedilo se prezre); % in _ v iskalnem nizu sta navadna znaka.
export async function listCatalog(pool: Pool, user: User, source: string | null, query: string | null, page: string | null): Promise<Result> {
  const wanted = source ?? 'all';
  if (!(SOURCES as readonly string[]).includes(wanted)) {
    return { status: 400, body: { errors: { source: 'Izvor mora biti all, mine, system ali shared' } } };
  }
  if (page !== null && !/^[1-9]\d{0,8}$/.test(page)) return { status: 400, body: { errors: { page: 'Stran mora biti celo število od 1 naprej' } } };
  const number = page === null ? 1 : Number(page);
  const text = (query ?? '').trim();
  const search = [...text].length >= SEARCH_MIN_LENGTH ? text : null;

  const values: unknown[] = [user.id];
  let where = `${VISIBLE} AND ${SOURCE_FILTERS[wanted as (typeof SOURCES)[number]]}`;
  if (search !== null) {
    values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    where += ` AND s.name ILIKE $${values.length}`;
  }
  const total = (await pool.query(`SELECT count(*)::int AS n ${FROM} WHERE ${where}`, values)).rows[0].n as number;
  values.push((number - 1) * CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE);
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY s.owner_id IS NOT NULL, s.id OFFSET $${values.length - 1} LIMIT $${values.length}`,
    values,
  );
  return {
    status: 200,
    body: { source: wanted, q: search ?? '', page: number, pageSize: CATALOG_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)), items: rows.map(present) },
  };
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

const NOT_FOUND: Result = { status: 404, body: { error: 'Strategija ne obstaja' } };

// Strategijo ureja in briše samo lastnik. Tuja zasebna strategija ni vidna (404, P1); vidna, a tuja
// (sistemska ali deljena) vrne 403.
async function ownedBy(pool: Pool, user: User, id: string): Promise<{ id: string } | Result> {
  if (!/^\d{1,15}$/.test(id)) return NOT_FOUND;
  const { rows } = await pool.query(`SELECT s.id, s.owner_id FROM strategies s WHERE s.id = $2 AND ${VISIBLE}`, [user.id, id]);
  if (!rows[0]) return NOT_FOUND;
  if (rows[0].owner_id === null || Number(rows[0].owner_id) !== user.id) {
    return { status: 403, body: { error: 'Strategije ne smete spreminjati ali brisati, ker niste njen lastnik' } };
  }
  return { id: String(rows[0].id) };
}

const isResult = (v: { id: string } | Result): v is Result => 'status' in v;

// Spremeni samo podana polja (ime, opis, datoteka, privzeti parametri); vidnost in lastnik se ne spreminjata.
export async function updateStrategy(pool: Pool, user: User, id: string, input: unknown): Promise<Result> {
  const owned = await ownedBy(pool, user, id);
  if (isResult(owned)) return owned;
  const body = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

  const sets: string[] = [];
  const values: unknown[] = [];
  const errors: FieldErrors = {};
  const apply = (column: string, key: string, check: (v: unknown) => { ok: true; value: unknown } | { ok: false; errors: FieldErrors }) => {
    if (body[key] === undefined) return;
    const checked = check(body[key]);
    if (!checked.ok) return void Object.assign(errors, checked.errors);
    values.push(checked.value);
    sets.push(`${column} = $${values.length}`);
  };
  apply('name', 'name', checkName);
  apply('description', 'description', checkDescription);
  apply('source', 'source', checkSource);
  apply('default_params', 'default_params', checkDefaultParams);

  if (Object.keys(errors).length > 0) return { status: 400, body: { errors } };
  if (sets.length === 0) return { status: 400, body: { error: 'Ni polj za spremembo' } };
  values.push(owned.id);
  await pool.query(`UPDATE strategies SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  return getStrategy(pool, user, owned.id);
}

async function testsUsing(pool: Pool, id: string): Promise<number> {
  return (await pool.query('SELECT count(*)::int AS n FROM backtests WHERE strategy_id = $1', [id])).rows[0].n as number;
}

const inUse = (tests: number): Result => ({
  status: 409,
  body: { error: `Strategije ni mogoče izbrisati, ker jo uporablja ${tests} ${tests === 1 ? 'test' : 'testov'}`, tests },
});

// Strategije, ki ima izvedene teste, ne izbrišemo; odgovor vsebuje število testov. Tuji ključ v bazi
// zavaruje tudi pred testom, ki bi nastal med preverjanjem in brisanjem.
export async function deleteStrategy(pool: Pool, user: User, id: string): Promise<Result> {
  const owned = await ownedBy(pool, user, id);
  if (isResult(owned)) return owned;
  const tests = await testsUsing(pool, owned.id);
  if (tests > 0) return inUse(tests);
  try {
    await pool.query('DELETE FROM strategies WHERE id = $1', [owned.id]);
  } catch (err) {
    if ((err as { code?: string }).code === '23503') return inUse(await testsUsing(pool, owned.id));
    throw err;
  }
  return { status: 200, body: { id: Number(owned.id) } };
}

// Lastnik preklopi vidnost strategije med private in shared (US-10). Deljena strategija je takoj vidna drugim
// trgovcem, ob vrnitvi na private pa takoj izgine iz njihovih seznamov; testi, ki so jih drugi že izvedli, ostanejo
// njihovi. Tuja zasebna strategija je 404, vidna a tuja (sistemska ali deljena) 403.
export async function setStrategyVisibility(pool: Pool, user: User, id: string, input: unknown): Promise<Result> {
  const owned = await ownedBy(pool, user, id);
  if (isResult(owned)) return owned;
  const visibility = input && typeof input === 'object' ? (input as Record<string, unknown>).visibility : undefined;
  if (visibility !== 'private' && visibility !== 'shared') return { status: 400, body: { errors: { visibility: 'Vidnost mora biti private ali shared' } } };
  await pool.query('UPDATE strategies SET visibility = $2 WHERE id = $1', [owned.id, visibility]);
  return getStrategy(pool, user, owned.id);
}
