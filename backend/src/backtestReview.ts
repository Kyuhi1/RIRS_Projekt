import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { getBacktest } from './backtestsApi.ts';
import { transition, type Action, type Status } from './testStatus.ts';

// Oddaja testa mentorju in umik oddaje (US-12). Vsak prehod je ena transakcija: sprememba stanja in
// zapis v status_history uspeta ali propadeta skupaj. Tuj ali neobstoječ test je 404 (kot povsod).
const NOT_FOUND: Result = { status: 404, body: { error: 'Test ne obstaja' } };
const NO_MENTOR: Result = { status: 409, body: { error: 'Test lahko oddate šele, ko imate aktivnega mentorja' } };

const WRONG_STATE: Record<string, string> = {
  submit: 'Oddati je mogoče samo osnutek testa',
  withdraw: 'Oddajo je mogoče umakniti samo, dokler mentor pregleda ni začel',
};

async function change(pool: Pool, user: User, id: string, action: Extract<Action, 'submit' | 'withdraw'>): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return NOT_FOUND;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: sočasna zahtevka za isti test se izvedeta eden za drugim.
    const { rows } = await client.query<{ status: Status; reviewer_id: string | null }>(
      'SELECT status, reviewer_id FROM backtests WHERE id = $1 AND owner_id = $2 FOR UPDATE',
      [id, user.id],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return NOT_FOUND;
    }
    const outcome = transition(rows[0].status, action, 'owner');
    if (!outcome.ok) {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: WRONG_STATE[action] } };
    }
    let reviewerId = rows[0].reviewer_id;
    if (action === 'submit') {
      const link = await client.query<{ mentor_id: string }>("SELECT mentor_id FROM mentor_links WHERE trader_id = $1 AND status = 'active'", [user.id]);
      if (!link.rows[0]) {
        await client.query('ROLLBACK');
        return NO_MENTOR;
      }
      reviewerId = link.rows[0].mentor_id;
    }
    await client.query('UPDATE backtests SET status = $2, reviewer_id = $3 WHERE id = $1', [id, outcome.to, reviewerId]);
    await client.query('INSERT INTO status_history (backtest_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4)', [id, rows[0].status, outcome.to, user.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getBacktest(pool, user, id);
}

export const submitBacktest = (pool: Pool, user: User, id: string) => change(pool, user, id, 'submit');
export const withdrawBacktest = (pool: Pool, user: User, id: string) => change(pool, user, id, 'withdraw');
