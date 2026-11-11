import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { visibleTo } from './backtestsApi.ts';

// Komentarji mentorja k testu (US-14). Bere jih lastnik testa in mentor, ki test vidi; piše jih lahko samo
// mentor, in sicer med pregledom (in_review). Komentarjev ni mogoče spreminjati ali brisati.
export const COMMENT_MAX = 2000;
const NOT_FOUND: Result = { status: 404, body: { error: 'Test ne obstaja' } };

const SELECT = `
  SELECT c.id::int AS id, c.body, c.is_mistake, c.created_at,
         jsonb_build_object('id', a.id::int, 'name', a.name) AS author
  FROM comments c JOIN users a ON a.id = c.author_id`;

export async function listComments(pool: Pool, user: User, id: string): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return NOT_FOUND;
  const { rows } = await pool.query(`${SELECT} JOIN backtests b ON b.id = c.backtest_id WHERE b.id = $1 AND ${visibleTo(user)} ORDER BY c.id`, [id, user.id]);
  if (rows.length > 0) return { status: 200, body: rows };
  const exists = await pool.query(`SELECT 1 FROM backtests b WHERE b.id = $1 AND ${visibleTo(user)}`, [id, user.id]);
  return exists.rowCount ? { status: 200, body: [] } : NOT_FOUND;
}

function validate(input: unknown): { data: { body: string; isMistake: boolean }; errors: Record<string, string> } {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const body = typeof source.body === 'string' ? source.body.trim() : '';
  if (body.length === 0) errors.body = 'Komentar ne sme biti prazen';
  else if ([...body].length > COMMENT_MAX) errors.body = `Komentar sme imeti največ ${COMMENT_MAX} znakov`;
  if (source.is_mistake !== undefined && typeof source.is_mistake !== 'boolean') errors.is_mistake = 'Oznaka napake mora biti true ali false';
  return { data: { body, isMistake: source.is_mistake === true }, errors };
}

// Doda komentar (samo mentor). Vrstica testa se zaklene, zato komentar in sočasna odobritev ne moreta
// prepletati: po odobritvi komentarja ni več mogoče dodati.
export async function addComment(pool: Pool, user: User, id: string, input: unknown): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return NOT_FOUND;
  const { data, errors } = validate(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string }>(`SELECT b.status FROM backtests b WHERE b.id = $1 AND ${visibleTo(user)} FOR UPDATE OF b`, [id, user.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return NOT_FOUND;
    }
    if (rows[0].status !== 'in_review') {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: 'Komentarje je mogoče dodajati samo med pregledom' } };
    }
    if (Object.keys(errors).length > 0) {
      await client.query('ROLLBACK');
      return { status: 400, body: { errors } };
    }
    const { rows: created } = await client.query('INSERT INTO comments (backtest_id, author_id, body, is_mistake) VALUES ($1, $2, $3, $4) RETURNING id', [id, user.id, data.body, data.isMistake]);
    await client.query('COMMIT');
    const { rows: shown } = await pool.query(`${SELECT} WHERE c.id = $1`, [created[0].id]);
    return { status: 201, body: shown[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
