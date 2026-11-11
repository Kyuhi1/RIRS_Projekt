import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { clearedCookie, sessionCookie, signToken } from './session.ts';

export interface Result {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'trader' | 'mentor' | 'admin';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 10;
export const REGISTER_ROLES = ['trader', 'mentor']; // pri samostojni registraciji vloge admin ni mogoče izbrati
export const ALL_ROLES = ['trader', 'mentor', 'admin'];

type Errors = Partial<Record<'name' | 'email' | 'password' | 'role', string>>;

function validate(input: unknown, roles: string[]) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' ? body.role : '';

  const errors: Errors = {};
  if (!name) errors.name = 'Vnesite ime in priimek';
  if (!EMAIL.test(email)) errors.email = 'Vnesite veljaven e-naslov';
  if (password.length < 8) errors.password = 'Geslo mora imeti najmanj 8 znakov';
  else if (Buffer.byteLength(password) > 72) errors.password = 'Geslo je predolgo (največ 72 bajtov)'; // bcrypt bi ga sicer tiho skrajšal
  if (!roles.includes(role)) errors.role = roles.includes('admin') ? 'Izberite vlogo Trgovec, Mentor ali Administrator' : 'Izberite vlogo Trgovec ali Mentor';
  return { data: { name, email, password, role }, errors };
}

// Ustvari račun; `roles` so vloge, ki jih klicatelj sme izbrati (registracija: trgovec in mentor, administrator: vse).
export async function createUser(pool: Pool, input: unknown, roles: string[]): Promise<Result> {
  const { data, errors } = validate(input, roles);
  if (Object.keys(errors).length > 0) return { status: 400, body: { errors } };

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  try {
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, blocked, created_at',
      [data.email, data.name, passwordHash, data.role],
    );
    return { status: 201, body: result.rows[0] };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      // kršitev enoličnosti e-naslova
      return { status: 409, body: { errors: { email: 'Račun s tem e-naslovom že obstaja' } } };
    }
    throw err;
  }
}

export async function register(pool: Pool, input: unknown): Promise<Result> {
  const result = await createUser(pool, input, REGISTER_ROLES);
  if (result.status !== 201) return result;
  const { id, email, name, role } = result.body as User;
  return { status: 201, body: { id, email, name, role } };
}

// Gesla ob neznanem e-naslovu primerjamo z lažnim zgoščenim geslom, da odziv ne izdaja obstoja računa.
const DUMMY_HASH = bcrypt.hashSync('ni-pravo-geslo', BCRYPT_COST);

export async function login(pool: Pool, jwtSecret: string, input: unknown): Promise<Result> {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const row = (
    await pool.query('SELECT id, email, name, role, password_hash, blocked FROM users WHERE email = $1', [email])
  ).rows[0];
  const valid = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !valid) return { status: 401, body: { error: 'Napačen e-naslov ali geslo' } };
  if (row.blocked) return { status: 403, body: { error: 'Račun je blokiran' } };

  const user: User = { id: Number(row.id), email: row.email, name: row.name, role: row.role };
  return { status: 200, body: user, headers: { 'Set-Cookie': sessionCookie(await signToken(jwtSecret, user.id)) } };
}

export function logout(): Result {
  return { status: 200, body: { status: 'ok' }, headers: { 'Set-Cookie': clearedCookie() } };
}

// Ob zagonu zagotovi administratorski račun iz ADMIN_EMAIL in ADMIN_PASSWORD.
// Obstoječemu računu z istim e-naslovom nastavi vlogo admin in ga odblokira, gesla ne spremeni.
export async function ensureAdmin(pool: Pool, email: string | undefined, password: string | undefined): Promise<'created' | 'updated' | 'skipped'> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !password) return 'skipped';
  if (!EMAIL.test(normalized)) throw new Error('ADMIN_EMAIL ni veljaven e-naslov');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD mora imeti najmanj 8 znakov');
  if (Buffer.byteLength(password) > 72) throw new Error('ADMIN_PASSWORD je predolg (največ 72 bajtov)');

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Administrator', $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', blocked = false
     RETURNING (xmax = 0) AS inserted`,
    [normalized, hash],
  );
  return result.rows[0].inserted ? 'created' : 'updated';
}
