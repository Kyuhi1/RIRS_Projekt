import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { MENTOR_STATUSES, visibleTo } from './backtestsApi.ts';

// Mentorjev dashboard (US-13): aktivni učenci s števili testov in seznam testov za pregled po stanjih.
export const REVIEW_PAGE_SIZE = 20;

// Aktivni učenci prijavljenega mentorja. `test_count` so vsi testi, ki jih mentor vidi (oddani in naprej,
// ne osnutki ali umaknjeni), `waiting_count` pa tisti v stanju submitted, ki čakajo na pregled.
export async function listStudents(pool: Pool, user: User): Promise<Result> {
  const { rows } = await pool.query(
    `SELECT t.id::int AS id, t.name, t.email,
            count(b.id)::int AS test_count,
            (count(b.id) FILTER (WHERE b.status = 'submitted'))::int AS waiting_count
     FROM mentor_links l
     JOIN users t ON t.id = l.trader_id
     LEFT JOIN backtests b ON b.owner_id = t.id AND ${visibleTo(user, 1)}
     WHERE l.mentor_id = $1 AND l.status = 'active'
     GROUP BY t.id ORDER BY t.name, t.id`,
    [user.id],
  );
  return { status: 200, body: rows };
}

// Testi za pregled v izbranem stanju (privzeto submitted), po 20 na stran. Čakajoči so od najstarejše oddaje,
// ostali od najnovejše. `submitted_at` je čas zadnje oddaje (iz status_history).
export async function listReviewQueue(pool: Pool, user: User, status: string | null, page: string | null): Promise<Result> {
  const wanted = status ?? 'submitted';
  if (!(MENTOR_STATUSES as readonly string[]).includes(wanted)) {
    return { status: 400, body: { errors: { status: 'Stanje mora biti submitted, in_review, changes_requested ali approved' } } };
  }
  if (page !== null && !/^[1-9]\d{0,8}$/.test(page)) return { status: 400, body: { errors: { page: 'Stran mora biti celo število od 1 naprej' } } };
  const number = page === null ? 1 : Number(page);
  const order = wanted === 'submitted' ? 'ASC' : 'DESC';
  const { rows } = await pool.query(
    `SELECT b.id::int AS id, s.name AS strategy_name, b.status,
            jsonb_build_object('id', o.id::int, 'name', o.name) AS owner,
            ARRAY(SELECT ticker FROM backtest_instruments WHERE backtest_id = b.id ORDER BY ticker) AS instruments,
            to_char(b.period_from, 'YYYY-MM-DD') AS "from", to_char(b.period_to, 'YYYY-MM-DD') AS "to",
            (SELECT max(h.changed_at) FROM status_history h WHERE h.backtest_id = b.id AND h.to_status = 'submitted') AS submitted_at,
            count(*) OVER ()::int AS total
     FROM backtests b JOIN strategies s ON s.id = b.strategy_id JOIN users o ON o.id = b.owner_id
     WHERE ${visibleTo(user, 1)} AND b.status = $2
     ORDER BY submitted_at ${order} NULLS LAST, b.id ${order}
     OFFSET $3 LIMIT $4`,
    [user.id, wanted, (number - 1) * REVIEW_PAGE_SIZE, REVIEW_PAGE_SIZE],
  );
  const total = rows[0]?.total ?? (number === 1 ? 0 : await countStatus(pool, user, wanted));
  return {
    status: 200,
    body: {
      status: wanted,
      page: number,
      pageSize: REVIEW_PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
      items: rows.map(({ total: _total, ...item }) => item),
    },
  };
}

// Skupno število za stran za zadnjo (ko je stran prazna, okno ne vrne števila).
async function countStatus(pool: Pool, user: User, status: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM backtests b WHERE ${visibleTo(user, 1)} AND b.status = $2`, [user.id, status]);
  return rows[0].n;
}
