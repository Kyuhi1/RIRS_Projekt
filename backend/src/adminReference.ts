import type { Pool } from 'pg';
import type { Result } from './auth.ts';

// Vzdrževanje referenčnih podatkov (US-16): sredstva, borze in načrti financiranih računov. Ključ zapisa
// (ticker oziroma id) se ob ustvarjanju določi in se ne spreminja. Že shranjeni rezultati testov se ne spremenijo (P8):
// rezultat hrani vse zneske sam, referenčni zapis daje samo imena za prikaz. Izbrisati ni mogoče zapisa, ki ga uporablja test.

type Body = Record<string, unknown>;
type Errors = Record<string, string>;
interface Parsed {
  values: unknown[]; // v vrstnem redu `columns`
  errors: Errors;
}
interface Entity {
  table: string;
  key: string;
  keyLabel: string;
  keyPattern: RegExp;
  keyMessage: string;
  columns: string[]; // stolpci brez ključa
  select: string; // seznam stolpcev za odgovor
  searchable: string[]; // besedilni stolpci, po katerih išče `q`
  used: (key: string) => string; // SQL za število testov, ki uporabljajo zapis; `key` je izraz s ključem
  parse: (body: Body) => Parsed;
}

const asBody = (input: unknown): Body => (typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Body) : {});
const text = (body: Body, field: string, max: number, label: string, errors: Errors): string => {
  const value = typeof body[field] === 'string' ? (body[field] as string).trim() : '';
  if (!value) errors[field] = `${label} je obvezno polje`;
  else if (value.length > max) errors[field] = `${label} je predolgo (največ ${max} znakov)`;
  return value;
};
// Število (ne niz); `min` je najmanjša dovoljena vrednost, `exclusive` pomeni strogo večje.
const num = (body: Body, field: string, label: string, errors: Errors, min: number, exclusive: boolean, max = Number.MAX_SAFE_INTEGER): number => {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) errors[field] = `${label} mora biti število`;
  else if (exclusive ? value <= min : value < min) errors[field] = exclusive ? `${label} mora biti večji od ${min}` : `${label} ne sme biti negativen`;
  else if (value > max) errors[field] = `${label} je prevelik (največ ${max})`;
  return value as number;
};

const ENTITIES: Record<'instruments' | 'venues' | 'prop-plans', Entity> = {
  instruments: {
    table: 'instruments', key: 'ticker', keyLabel: 'Oznaka', keyPattern: /^[A-Z0-9][A-Z0-9._-]{0,19}$/,
    keyMessage: 'Oznaka sme imeti velike črke, števke ter znake . _ - (največ 20 znakov)',
    columns: ['description', 'asset_class'],
    select: 'ticker, description, asset_class',
    searchable: ['ticker', 'description'],
    used: (key) => `SELECT count(DISTINCT backtest_id)::int AS count FROM backtest_instruments WHERE ticker = ${key}`,
    parse: (body) => {
      const errors: Errors = {};
      const description = text(body, 'description', 200, 'Opis', errors);
      const asset = body.asset_class;
      if (typeof asset !== 'string' || !['crypto', 'forex', 'index', 'gold'].includes(asset)) errors.asset_class = 'Skupina sredstev mora biti crypto, forex, index ali gold';
      return { values: [description, asset], errors };
    },
  },
  venues: {
    table: 'venues', key: 'id', keyLabel: 'Id', keyPattern: /^[a-z0-9][a-z0-9-]{0,39}$/,
    keyMessage: 'Id sme imeti male črke, števke in vezaje (največ 40 znakov)',
    columns: ['name', 'maker_pct', 'taker_pct', 'pay_spread'],
    select: 'id, name, maker_pct, taker_pct, pay_spread',
    searchable: ['id', 'name'],
    used: (key) => `SELECT count(*)::int AS count FROM backtests WHERE venue_id = ${key}`,
    parse: (body) => {
      const errors: Errors = {};
      const name = text(body, 'name', 100, 'Ime', errors);
      const maker = num(body, 'maker_pct', 'Provizija maker', errors, 0, false, 1);
      const taker = num(body, 'taker_pct', 'Provizija taker', errors, 0, false, 1);
      if (typeof body.pay_spread !== 'boolean') errors.pay_spread = 'Plačilo razpona mora biti da ali ne';
      return { values: [name, maker, taker, body.pay_spread], errors };
    },
  },
  'prop-plans': {
    table: 'prop_plans', key: 'id', keyLabel: 'Id', keyPattern: /^[a-z0-9][a-z0-9-]{0,39}$/,
    keyMessage: 'Id sme imeti male črke, števke in vezaje (največ 40 znakov)',
    columns: ['firm_name', 'plan_name', 'account_size', 'max_daily_loss', 'max_total_loss', 'profit_target'],
    select: 'id, firm_name, plan_name, account_size, max_daily_loss, max_total_loss, profit_target',
    searchable: ['id', 'firm_name', 'plan_name'],
    used: (key) => `SELECT count(*)::int AS count FROM backtests WHERE prop_plan_id = ${key}`,
    parse: (body) => {
      const errors: Errors = {};
      const firm = text(body, 'firm_name', 100, 'Podjetje', errors);
      const plan = text(body, 'plan_name', 100, 'Načrt', errors);
      // Zneski morajo biti večji od 0 (kot v bazi): račun z ničelno velikostjo ali mejo ni smiseln in bi pokvaril simulacijo.
      const size = num(body, 'account_size', 'Velikost računa', errors, 0, true);
      const daily = num(body, 'max_daily_loss', 'Največja dnevna izguba', errors, 0, true);
      const total = num(body, 'max_total_loss', 'Največja skupna izguba', errors, 0, true);
      const target = num(body, 'profit_target', 'Cilj dobička', errors, 0, true);
      return { values: [firm, plan, size, daily, total, target], errors };
    },
  },
};
export type EntityName = keyof typeof ENTITIES;
export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];

const notFound: Result = { status: 404, body: { error: 'Zapis ne obstaja' } };
const decode = (key: string): string | null => {
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
};

// Seznam zapisov z `used_by` (število testov, ki zapis uporabljajo); `q` išče po ključu in imenu.
export async function listReference(pool: Pool, name: EntityName, q: string | null): Promise<Result> {
  const e = ENTITIES[name];
  const search = (q ?? '').trim();
  const { rows } = await pool.query(
    `SELECT ${e.select}, (${e.used(`t.${e.key}`)}) AS used_by
     FROM ${e.table} t
     WHERE $1 = '' OR concat_ws(' ', ${e.searchable.join(', ')}) ILIKE '%' || replace(replace(replace($1, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
     ORDER BY ${e.key}`,
    [search],
  );
  return { status: 200, body: rows };
}

export async function createReference(pool: Pool, name: EntityName, input: unknown): Promise<Result> {
  const e = ENTITIES[name];
  const body = asBody(input);
  const parsed = e.parse(body);
  const key = typeof body[e.key] === 'string' ? (body[e.key] as string).trim() : '';
  if (!e.keyPattern.test(key)) parsed.errors[e.key] = key ? e.keyMessage : `${e.keyLabel} je obvezno polje`;
  if (Object.keys(parsed.errors).length > 0) return { status: 400, body: { errors: parsed.errors } };
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${e.table} (${[e.key, ...e.columns].join(', ')}) VALUES (${[key, ...parsed.values].map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${e.select}`,
      [key, ...parsed.values],
    );
    return { status: 201, body: { ...rows[0], used_by: 0 } };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return { status: 409, body: { errors: { [e.key]: `${e.keyLabel} že obstaja` } } };
    throw err;
  }
}

// Posodobi polja zapisa (ključ je nespremenljiv; če ga telo vsebuje in je drugačen, je napaka).
export async function updateReference(pool: Pool, name: EntityName, rawKey: string, input: unknown): Promise<Result> {
  const e = ENTITIES[name];
  const key = decode(rawKey);
  if (key === null) return notFound;
  const body = asBody(input);
  const parsed = e.parse(body);
  if (body[e.key] !== undefined && body[e.key] !== key) parsed.errors[e.key] = `${e.keyLabel} se ne more spremeniti`;
  if (Object.keys(parsed.errors).length > 0) {
    const exists = (await pool.query(`SELECT 1 FROM ${e.table} WHERE ${e.key} = $1`, [key])).rowCount;
    return exists ? { status: 400, body: { errors: parsed.errors } } : notFound;
  }
  const { rows } = await pool.query(
    `UPDATE ${e.table} SET ${e.columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE ${e.key} = $1 RETURNING ${e.select}`,
    [key, ...parsed.values],
  );
  if (!rows[0]) return notFound;
  const used = (await pool.query(e.used('$1'), [key])).rows[0].count as number;
  return { status: 200, body: { ...rows[0], used_by: used } };
}

// Izbriše zapis, če ga ne uporablja noben test; sicer 409 s številom testov. Sredstvu se izbrišejo tudi razponi (spreads).
export async function deleteReference(pool: Pool, name: EntityName, rawKey: string): Promise<Result> {
  const e = ENTITIES[name];
  const key = decode(rawKey);
  if (key === null) return notFound;
  const inUse = async (): Promise<Result> => {
    const tests = (await pool.query(e.used('$1'), [key])).rows[0].count as number;
    return { status: 409, body: { error: `Zapisa ni mogoče izbrisati, uporablja ga ${tests} ${tests === 1 ? 'test' : 'testov'}`, tests } };
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (name === 'instruments') await client.query('DELETE FROM spreads WHERE ticker = $1', [key]);
    const { rowCount } = await client.query(`DELETE FROM ${e.table} WHERE ${e.key} = $1`, [key]);
    await client.query('COMMIT');
    return rowCount ? { status: 200, body: { status: 'deleted' } } : notFound;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23503') return inUse(); // uporablja ga test (tudi ob sočasnem ustvarjanju)
    throw err;
  } finally {
    client.release();
  }
}
