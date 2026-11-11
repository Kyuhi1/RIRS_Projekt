import type { Pool } from 'pg';
import type { Result, User } from './auth.ts';
import { BacktestError, computeBacktest } from './backtest.ts';
import type { CandleStore } from './candles.ts';

const SELECT = `
  SELECT b.id, b.strategy_id, s.name AS strategy_name, b.venue_id,
         ARRAY(SELECT ticker FROM backtest_instruments WHERE backtest_id = b.id ORDER BY ticker) AS instruments,
         to_char(b.period_from, 'YYYY-MM-DD') AS "from", to_char(b.period_to, 'YYYY-MM-DD') AS "to",
         b.params, b.status, b.visibility, b.created_at, b.challenge_passed, b.previous_id,
         (SELECT n.id FROM backtests n WHERE n.previous_id = b.id) AS next_id,
         (SELECT jsonb_build_object('id', u.id::int, 'name', u.name) FROM users u WHERE u.id = b.reviewer_id) AS reviewer,
         (SELECT jsonb_build_object('id', o.id::int, 'name', o.name) FROM users o WHERE o.id = b.owner_id) AS owner,
         CASE WHEN pp.id IS NULL THEN NULL ELSE jsonb_build_object('id', pp.id, 'firm_name', pp.firm_name, 'plan_name', pp.plan_name,
           'account_size', pp.account_size, 'profit_target', pp.profit_target,
           'max_daily_loss', pp.max_daily_loss, 'max_total_loss', pp.max_total_loss) END AS prop_plan`;
// Kdo vidi test (`param` je številka parametra z id-jem uporabnika): trgovec svoje teste, mentor oddane teste
// svojih aktivnih učencev. Osnutkov in umaknjenih testov mentor ne vidi, prav tako ne testov učenca po
// prekinitvi povezave ali testov, oddanih drugemu mentorju. Tuj test je vedno kot neobstoječ (404, P1).
export const MENTOR_STATUSES = ['submitted', 'in_review', 'changes_requested', 'approved'] as const;
export const visibleTo = (user: User, param = 2): string =>
  user.role === 'mentor'
    ? `(b.reviewer_id = $${param} AND b.status IN ('submitted', 'in_review', 'changes_requested', 'approved')
        AND EXISTS (SELECT 1 FROM mentor_links l WHERE l.mentor_id = $${param} AND l.trader_id = b.owner_id AND l.status = 'active'))`
    : `b.owner_id = $${param}`;

// Kdo test sme brati: kdor ga vidi (visibleTo), poleg tega vsak trgovec, če je lastnik test delil (visibility = shared).
// Tuj deljeni test je samo za branje; vsa dejanja (oddaja, umik, ponovitev, komentarji, vidnost) ostanejo lastniku ali mentorju.
export const viewableBy = (user: User, param = 2): string =>
  user.role === 'trader' ? `(b.owner_id = $${param} OR b.visibility = 'shared')` : visibleTo(user, param);

const FROM = 'FROM backtests b JOIN strategies s ON s.id = b.strategy_id LEFT JOIN prop_plans pp ON pp.id = b.prop_plan_id';

const asNumber = (value: string | null) => (value === null ? null : Number(value));

const withId = <T extends { id: string; strategy_id: string; previous_id: string | null; next_id: string | null }>({ id, strategy_id, previous_id, next_id, ...rest }: T) => ({
  id: Number(id),
  strategy_id: Number(strategy_id),
  previous_id: asNumber(previous_id),
  next_id: asNumber(next_id),
  ...rest,
});

// Izračuna test in ga šele ob uspehu shrani v stanju draft (skupaj s sredstvi, v eni transakciji).
export async function createBacktest(pool: Pool, store: CandleStore, user: User, input: unknown, previousId: string | null = null): Promise<Result> {
  try {
    const test = await computeBacktest(pool, store, user, input);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, params, results, prop_plan_id, challenge_passed, previous_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [user.id, test.strategyId, test.venueId, test.from, test.to, test.params, test.results, test.propPlanId, test.challengePassed, previousId],
      );
      const id = rows[0].id as string;
      await client.query('INSERT INTO backtest_instruments (backtest_id, ticker) SELECT $1, unnest($2::text[])', [id, test.instruments]);
      await client.query('COMMIT');
      return getBacktest(pool, user, id, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof BacktestError) return { status: err.status, body: err.body };
    throw err;
  }
}

const SUMMARY = `jsonb_build_object('netProfit', b.results -> 'netProfit', 'returnPct', b.results -> 'returnPct',
         'tradeCount', b.results -> 'tradeCount', 'winRatePct', b.results -> 'winRatePct',
         'maxDrawdownPct', b.results -> 'maxDrawdownPct')`;

// Seznam testov, najnovejši prvi, s povzetkom rezultatov (brez krivulje in poslov). `mine` (privzeto) so lastni testi,
// `shared` testi drugih trgovcev z vidnostjo shared; pri tujih so mentor, zgodovina in povezave med testi skriti.
export async function listBacktests(pool: Pool, user: User, scope: string | null = null): Promise<Result> {
  const wanted = scope ?? 'mine';
  if (wanted !== 'mine' && wanted !== 'shared') return { status: 400, body: { errors: { scope: 'Obseg mora biti mine ali shared' } } };
  const { rows } = await pool.query(
    `${SELECT}, ${SUMMARY} AS summary ${FROM}
     WHERE ${wanted === 'mine' ? 'b.owner_id = $1' : "b.visibility = 'shared' AND b.owner_id <> $1"} ORDER BY b.id DESC`,
    [user.id],
  );
  const items = rows.map(withId);
  return { status: 200, body: wanted === 'mine' ? items : items.map(hidePrivate) };
}

// Pri tujem testu so podrobnosti oddaje mentorju (mentor, zgodovina, povezave med testi) zasebne.
const hidePrivate = <T extends { previous_id: number | null; next_id: number | null }>(test: T) => ({ ...test, reviewer: null, previous_id: null, next_id: null });

// Test vidi lastnik ali (samo za branje) mentor oddanega testa; tuj ali neobstoječ test vrne 404.
// `owner` je trgovec, ki je test naredil.
// Posli niso del odgovora (lahko jih je veliko); dobi jih `getTrades` po straneh.
export async function getBacktest(pool: Pool, user: User, id: string, status = 200): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rows } = await pool.query(`${SELECT}, b.results - 'trades' AS results,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'changed_at', h.changed_at,
                   'changed_by', jsonb_build_object('id', c.id::int, 'name', c.name)) ORDER BY h.id)
                 FROM status_history h JOIN users c ON c.id = h.changed_by WHERE h.backtest_id = b.id), '[]'::jsonb) AS history
     ${FROM} WHERE b.id = $1 AND ${viewableBy(user)}`, [id, user.id]);
  if (!rows[0]) return { status: 404, body: { error: 'Test ne obstaja' } };
  const test = withId(rows[0]) as ReturnType<typeof withId> & { owner: { id: number } };
  const foreign = user.role === 'trader' && test.owner.id !== user.id; // tuj deljeni test
  return { status, body: foreign ? { ...hidePrivate(test), history: [] } : test };
}

export const TRADES_PAGE_SIZE = 20;

// Posli testa, razvrščeni po času vstopa (pri enakem času po vrstnem redu izračuna), po 20 na stran.
// `page` je celo število od 1 naprej; stran za zadnjo je veljavna in vrne prazen seznam.
export async function getTrades(pool: Pool, user: User, id: string, page: string | null): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  if (page !== null && !/^[1-9]\d{0,8}$/.test(page)) return { status: 400, body: { errors: { page: 'Stran mora biti celo število od 1 naprej' } } };
  const number = page === null ? 1 : Number(page);
  const { rows } = await pool.query(
    `SELECT jsonb_array_length(b.results -> 'trades') AS total,
            ARRAY(SELECT x.t FROM jsonb_array_elements(b.results -> 'trades') WITH ORDINALITY AS x(t, n)
                  ORDER BY (x.t ->> 'entryTime')::bigint, x.n OFFSET $3 LIMIT $4) AS trades
     FROM backtests b WHERE b.id = $1 AND ${viewableBy(user)}`,
    [id, user.id, (number - 1) * TRADES_PAGE_SIZE, TRADES_PAGE_SIZE],
  );
  if (!rows[0]) return { status: 404, body: { error: 'Test ne obstaja' } };
  const total = rows[0].total as number;
  return { status: 200, body: { page: number, pageSize: TRADES_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / TRADES_PAGE_SIZE)), trades: rows[0].trades } };
}

// Rezultatov in parametrov izvedenega testa ni mogoče spreminjati: vidni test vrne 403, nevidni 404.
export async function rejectEdit(pool: Pool, user: User, id: string): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rowCount } = await pool.query(`SELECT 1 FROM backtests b WHERE b.id = $1 AND ${viewableBy(user)}`, [id, user.id]);
  if (!rowCount) return { status: 404, body: { error: 'Test ne obstaja' } };
  return { status: 403, body: { error: 'Parametrov in rezultatov testa ni mogoče spreminjati' } };
}

const ALREADY_RETESTED: Result = { status: 409, body: { error: 'Ta test je že bil ponovljen' } };

// »Ponovi test« (US-12): iz testa s zahtevanimi spremembami (changes_requested) nastane nov test z istimi
// nastavitvami (strategija, parametri, sredstva, borza, obdobje, načrt), ki se izračuna znova s trenutno
// strategijo in podatki. Nov test je osnutek in kaže na prejšnjega (`previous_id`); iz enega testa nastane
// največ ena ponovitev. Samo lastnik; tuj ali neobstoječ test je 404, test v drugem stanju 409.
export async function retestBacktest(pool: Pool, store: CandleStore, user: User, id: string): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rows } = await pool.query(
    `SELECT b.id, b.status, b.strategy_id::int AS strategy_id, b.venue_id, b.params, b.prop_plan_id,
            to_char(b.period_from, 'YYYY-MM-DD') AS "from", to_char(b.period_to, 'YYYY-MM-DD') AS "to",
            ARRAY(SELECT ticker FROM backtest_instruments WHERE backtest_id = b.id ORDER BY ticker) AS instruments,
            EXISTS (SELECT 1 FROM backtests n WHERE n.previous_id = b.id) AS retested
     FROM backtests b WHERE b.id = $1 AND ${visibleTo(user)}`,
    [id, user.id],
  );
  const original = rows[0];
  if (!original) return { status: 404, body: { error: 'Test ne obstaja' } };
  if (original.status !== 'changes_requested') return { status: 409, body: { error: 'Ponoviti je mogoče samo test, pri katerem je mentor zahteval spremembe' } };
  if (original.retested) return ALREADY_RETESTED;
  const input = {
    strategy_id: original.strategy_id,
    params: original.params,
    instruments: original.instruments,
    venue_id: original.venue_id,
    from: original.from,
    to: original.to,
    prop_plan_id: original.prop_plan_id,
  };
  try {
    return await createBacktest(pool, store, user, input, id);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return ALREADY_RETESTED; // sočasna ponovitev istega testa
    throw err;
  }
}

// Lastnik preklopi vidnost testa med private in shared (US-10). Deljeni test drugi trgovci vidijo samo za branje,
// ob vrnitvi na private takoj izgine iz njihovih seznamov. Tuj deljeni test je 403, tuj zasebni ali neobstoječ 404.
export async function setBacktestVisibility(pool: Pool, user: User, id: string, input: unknown): Promise<Result> {
  if (!/^\d{1,15}$/.test(id)) return { status: 404, body: { error: 'Test ne obstaja' } };
  const { rows } = await pool.query('SELECT b.owner_id FROM backtests b WHERE b.id = $1 AND ' + viewableBy(user), [id, user.id]);
  if (!rows[0]) return { status: 404, body: { error: 'Test ne obstaja' } };
  if (Number(rows[0].owner_id) !== user.id) return { status: 403, body: { error: 'Vidnosti testa lahko spremeni samo njegov lastnik' } };
  const visibility = input && typeof input === 'object' ? (input as Record<string, unknown>).visibility : undefined;
  if (visibility !== 'private' && visibility !== 'shared') return { status: 400, body: { errors: { visibility: 'Vidnost mora biti private ali shared' } } };
  await pool.query('UPDATE backtests SET visibility = $2 WHERE id = $1', [id, visibility]);
  return getBacktest(pool, user, id);
}

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

// Primerjava 2–4 testov (US-09): `ids` je seznam id-jev, ločenih z vejicami (npr. `3,7,9`), vrstni red se ohrani.
// Primerjati je mogoče samo teste, ki jih trgovec sme brati (lastne in deljene); če je kateri nevidni ali neobstoječ,
// vrne 404 za celoto, da ni mogoče ugotoviti, kateri tuji testi obstajajo (P1). Tuji testi so brez mentorja in povezav.
export async function compareBacktests(pool: Pool, user: User, ids: string | null): Promise<Result> {
  const parts = ids === null || ids === '' ? [] : ids.split(',');
  if (!parts.every((part) => /^[1-9]\d{0,14}$/.test(part))) return { status: 400, body: { errors: { ids: 'Id-ji morajo biti cela števila, ločena z vejicami' } } };
  if (new Set(parts).size !== parts.length) return { status: 400, body: { errors: { ids: 'Isti test je izbran večkrat' } } };
  if (parts.length < COMPARE_MIN || parts.length > COMPARE_MAX) {
    return { status: 400, body: { errors: { ids: `Izberite od ${COMPARE_MIN} do ${COMPARE_MAX} testov` } } };
  }
  const { rows } = await pool.query(
    `${SELECT}, jsonb_build_object('initialCapital', b.results -> 'initialCapital', 'netProfit', b.results -> 'netProfit',
         'returnPct', b.results -> 'returnPct', 'tradeCount', b.results -> 'tradeCount', 'winRatePct', b.results -> 'winRatePct',
         'maxDrawdownPct', b.results -> 'maxDrawdownPct', 'equityCurve', b.results -> 'equityCurve') AS results
     ${FROM} WHERE b.id = ANY($1::bigint[]) AND ${viewableBy(user, 2)}`,
    [parts, user.id],
  );
  if (rows.length !== parts.length) return { status: 404, body: { error: 'Test ne obstaja' } };
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  // Mentor, stanje pregleda in povezave med testi niso del primerjave (pri tujih testih so zasebni).
  const tests = parts.map((part) => {
    const row = byId.get(Number(part));
    return {
      id: Number(row.id), strategy_id: Number(row.strategy_id), strategy_name: row.strategy_name, venue_id: row.venue_id,
      instruments: row.instruments, from: row.from, to: row.to, params: row.params, owner: row.owner,
      prop_plan: row.prop_plan, challenge_passed: row.challenge_passed, results: row.results,
    };
  });
  return { status: 200, body: { tests } };
}
