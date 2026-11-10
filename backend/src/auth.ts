import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';

export interface Result {
  status: number;
  body: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 10;
const REGISTER_ROLES = ['trader', 'mentor']; // vloge admin ni mogoče izbrati

type Errors = Partial<Record<'name' | 'email' | 'password' | 'role', string>>;

function validate(input: unknown) {
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
  if (!REGISTER_ROLES.includes(role)) errors.role = 'Izberite vlogo Trgovec ali Mentor';
  return { data: { name, email, password, role }, errors };
}

export async function register(pool: Pool, input: unknown): Promise<Result> {
  const { data, errors } = validate(input);
  if (Object.keys(errors).length > 0) return { status: 400, body: { errors } };

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  try {
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
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
