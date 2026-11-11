import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { visibleTo } from './backtestsApi.ts';

// Skupna analitika učencev (US-15). Šteje samo testi, ki jih mentor sme videti (visibleTo: oddani in naprej, njegov
// pregled, aktivna povezava), torej osnutkov in umaknjenih testov ni. Obdobje omeji po času zadnje oddaje testa.
export const PERIODS = { all: null, '30': 30, '90': 90 } as const;
type Period = keyof typeof PERIODS;

const round = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

// Za vsakega aktivnega učenca: število testov, delež odobrenih, število napak (komentarji z is_mistake) in povprečni
// največji padec. Učenec brez testov ima delež in padec `null` (ne 0). Skupaj: vsote, povprečno število testov in napak
// na učenca ter delež odobrenih in padec, združena čez vse teste (ne povprečje povprečij). Brez učencev ali testov so povprečja `null`.
export async function studentAnalytics(pool: Pool, user: User, period: string | null): Promise<Result> {
  const wanted = (period ?? 'all') as Period;
  if (!Object.hasOwn(PERIODS, wanted)) return { status: 400, body: { errors: { period: 'Obdobje mora biti 30, 90 ali all' } } };
  const { rows } = await pool.query(
    `SELECT t.id::int AS id, t.name, t.email,
            count(x.id)::int AS tests,
            (count(x.id) FILTER (WHERE x.status = 'approved'))::int AS approved,
            COALESCE(sum(x.mistakes), 0)::int AS mistakes,
            count(x.drawdown)::int AS drawdown_n,
            COALESCE(sum(x.drawdown), 0)::float8 AS drawdown_sum
     FROM mentor_links l
     JOIN users t ON t.id = l.trader_id
     LEFT JOIN LATERAL (
       SELECT b.id, b.status, (b.results ->> 'maxDrawdownPct')::float8 AS drawdown,
              (SELECT count(*) FROM comments c WHERE c.backtest_id = b.id AND c.is_mistake) AS mistakes
       FROM backtests b
       WHERE b.owner_id = t.id AND ${visibleTo(user, 1)}
         AND ($2::int IS NULL OR (SELECT max(h.changed_at) FROM status_history h WHERE h.backtest_id = b.id AND h.to_status = 'submitted')
                                  >= now() - $2::int * interval '1 day')
     ) x ON true
     WHERE l.mentor_id = $1 AND l.status = 'active'
     GROUP BY t.id ORDER BY t.name, t.id`,
    [user.id, PERIODS[wanted]],
  );
  const share = (part: number, whole: number) => (whole === 0 ? null : round((part / whole) * 100));
  const students = rows.map((r) => ({
    id: r.id as number, name: r.name as string, email: r.email as string,
    tests: r.tests as number, approved: r.approved as number, approvedPct: share(r.approved, r.tests),
    mistakes: r.mistakes as number, avgMaxDrawdownPct: r.drawdown_n === 0 ? null : round(r.drawdown_sum / r.drawdown_n),
  }));
  const sum = (key: 'tests' | 'approved' | 'mistakes') => rows.reduce((total, r) => total + (r[key] as number), 0);
  const total = { tests: sum('tests'), approved: sum('approved'), mistakes: sum('mistakes') };
  const drawdownN = rows.reduce((n, r) => n + (r.drawdown_n as number), 0);
  const drawdownSum = rows.reduce((n, r) => n + (r.drawdown_sum as number), 0);
  const average = students.length === 0
    ? null
    : {
        testsPerStudent: round(total.tests / students.length), mistakesPerStudent: round(total.mistakes / students.length),
        approvedPct: share(total.approved, total.tests), avgMaxDrawdownPct: drawdownN === 0 ? null : round(drawdownSum / drawdownN),
      };
  return { status: 200, body: { period: wanted, students, total, average } };
}
