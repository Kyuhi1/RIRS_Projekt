import type { Pool } from 'pg';
import type { User } from './auth.ts';
import type { CandleStore } from './candles.ts';
import { checkChallenge, type ChallengeResult } from './propRules.ts';
import { simulate, SimulationError, type SimulationResult, type SpreadLookup } from './simulation.ts';
import { runStrategy, StrategyError } from './strategy.ts';

// Začetni kapital testa (razdeli se enakomerno med izbrana sredstva). Privzeto 10.000, uporabnik ga lahko izbere.
export const INITIAL_CAPITAL = 10_000;
export const MIN_CAPITAL = 100;
export const MAX_CAPITAL = 1_000_000_000;
const MAX_RUNTIME_MS = 300_000; // skupni čas strategij za vsa sredstva (5 minut)
const MAX_INSTRUMENTS = 30;
// Največ svečk na sredstvo (po združitvi v izbrani časovni okvir). Svečke se naložijo v pomnilnik in prenesejo v
// delavca (1 GB). 1.000.000 minutnih svečk je okoli 1,9 leta podatkov; za daljša obdobja uporabnik izbere
// daljši časovni okvir (npr. 1 ura: 1.000.000 svečk je več kot 100 let).
export const MAX_BARS = 1_000_000;
// Časovni okviri: izbrani okvir določa dolžino svečke, ki jo dobi strategija (podatki so minutni).
export const TIMEFRAMES = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 } as const;
export type Timeframe = keyof typeof TIMEFRAMES;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Napaka z odgovorom za uporabnika: 400 (neveljaven vhod, polja v `errors`) ali 422 (izračun ni uspel).
export class BacktestError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}

export interface ComputedBacktest {
  strategyId: number;
  venueId: string;
  instruments: string[];
  from: string; // YYYY-MM-DD
  to: string;
  params: Record<string, unknown>; // privzeti parametri strategije z vrednostmi, spremenjenimi za ta test
  timeframe: Timeframe;
  initialCapital: number; // z načrtom financiranega računa je to velikost računa
  propPlanId: string | null; // neobvezen načrt financiranega računa
  challengePassed: boolean | null; // izid preverjanja pravil; null brez načrta
  results: SimulationResult & { timeframe: Timeframe; challenge?: ChallengeResult }; // `challenge` samo, če je načrt izbran
}

type Errors = Record<string, string>;
interface PropPlanRow {
  account_size: number;
  profit_target: number;
  max_daily_loss: number;
  max_total_loss: number;
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayString = (iso: string) => iso.slice(0, 10);

// Preveri obliko zahtevka; vrne očiščene vrednosti ali napake po poljih.
function parse(input: unknown) {
  const body = isObject(input) ? input : {};
  const errors: Errors = {};

  const rawId = body.strategy_id;
  const strategyId = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^\d{1,15}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(strategyId) || strategyId <= 0) errors.strategy_id = 'Izberite strategijo';

  const rawInstruments = body.instruments;
  const instruments = Array.isArray(rawInstruments) ? rawInstruments : [];
  if (instruments.length === 0 || !instruments.every((t) => typeof t === 'string' && t !== '')) {
    errors.instruments = 'Izberite vsaj eno sredstvo';
  } else if (new Set(instruments).size !== instruments.length) errors.instruments = 'Sredstvo je izbrano večkrat';
  else if (instruments.length > MAX_INSTRUMENTS) errors.instruments = `Izberete lahko največ ${MAX_INSTRUMENTS} sredstev`;

  const venueId = typeof body.venue_id === 'string' ? body.venue_id : '';
  if (!venueId) errors.venue_id = 'Izberite borzo';

  const valid = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && new Date(toMs(d)).toISOString().startsWith(d);
  if (!valid(body.from)) errors.from = 'Vnesite veljaven datum »od«';
  if (!valid(body.to)) errors.to = 'Vnesite veljaven datum »do«';
  if (!errors.from && !errors.to && (body.from as string) >= (body.to as string)) {
    errors.to = 'Datum »od« mora biti pred datumom »do«';
  }

  if (body.params !== undefined && !isObject(body.params)) errors.params = 'Parametri morajo biti objekt JSON';

  const rawCapital = body.initial_capital;
  const capital = rawCapital === undefined || rawCapital === null || rawCapital === '' ? INITIAL_CAPITAL : typeof rawCapital === 'number' ? rawCapital : typeof rawCapital === 'string' && /^\d+(\.\d{1,2})?$/.test(rawCapital) ? Number(rawCapital) : NaN;
  if (!Number.isFinite(capital) || capital < MIN_CAPITAL || capital > MAX_CAPITAL) {
    errors.initial_capital = `Začetni kapital mora biti število med ${MIN_CAPITAL.toLocaleString('sl-SI')} in ${MAX_CAPITAL.toLocaleString('sl-SI')}`;
  }

  const rawTimeframe = body.timeframe === undefined || body.timeframe === null || body.timeframe === '' ? '1m' : body.timeframe;
  if (typeof rawTimeframe !== 'string' || !Object.hasOwn(TIMEFRAMES, rawTimeframe)) errors.timeframe = `Časovni okvir mora biti eden od: ${Object.keys(TIMEFRAMES).join(', ')}`;

  // Načrt financiranega računa je neobvezen; prazna vrednost pomeni brez načrta.
  const rawPlan = body.prop_plan_id;
  const noPlan = rawPlan === undefined || rawPlan === null || rawPlan === '';
  if (!noPlan && (typeof rawPlan !== 'string' || rawPlan.length > 100)) errors.prop_plan_id = 'Neveljaven načrt financiranega računa';

  return {
    errors,
    strategyId,
    instruments: instruments as string[],
    venueId,
    from: body.from as string,
    to: body.to as string,
    params: isObject(body.params) ? body.params : {},
    initialCapital: capital,
    timeframe: rawTimeframe as Timeframe,
    propPlanId: noPlan || typeof rawPlan !== 'string' ? null : rawPlan,
  };
}

export async function computeBacktest(
  pool: Pool,
  store: CandleStore,
  user: User,
  input: unknown,
  options: { timeoutMs?: number; maxBars?: number } = {},
): Promise<ComputedBacktest> {
  const startedAt = Date.now();
  const deadlineMs = options.timeoutMs ?? MAX_RUNTIME_MS;
  const maxBars = options.maxBars ?? MAX_BARS;
  const fail = (errors: Errors) => new BacktestError(400, { errors });

  const request = parse(input);
  if (Object.keys(request.errors).length > 0) throw fail(request.errors);

  // Referenčni podatki: strategija (samo vidna uporabniku), borza in sredstva.
  const strategy = (
    await pool.query(
      `SELECT id, source, default_params FROM strategies
       WHERE id = $1 AND (owner_id IS NULL OR owner_id = $2 OR visibility = 'shared')`,
      [request.strategyId, user.id],
    )
  ).rows[0];
  if (!strategy) throw fail({ strategy_id: 'Izbrana strategija ne obstaja' });

  const venue = (await pool.query('SELECT maker_pct, taker_pct, pay_spread FROM venues WHERE id = $1', [request.venueId])).rows[0];
  if (!venue) throw fail({ venue_id: 'Izbrana borza ne obstaja' });

  // Z načrtom test teče s kapitalom financiranega računa (`account_size`), sicer s kapitalom, ki ga izbere uporabnik.
  let plan: PropPlanRow | undefined;
  if (request.propPlanId !== null) {
    plan = (await pool.query('SELECT account_size, profit_target, max_daily_loss, max_total_loss FROM prop_plans WHERE id = $1', [request.propPlanId])).rows[0];
    if (!plan) throw fail({ prop_plan_id: 'Izbrani načrt financiranega računa ne obstaja' });
  }

  const known = (await pool.query('SELECT ticker FROM instruments WHERE ticker = ANY($1)', [request.instruments])).rows.map((r) => r.ticker);
  const unknown = request.instruments.filter((t) => !known.includes(t));
  if (unknown.length > 0) throw fail({ instruments: `Neznano sredstvo: ${unknown.join(', ')}` });

  // Obdobje mora ležati v razponu podatkov vseh izbranih sredstev (po dnevih, UTC).
  let lo = '0000-00-00';
  let hi = '9999-99-99';
  for (const ticker of request.instruments) {
    const range = await store.range(ticker);
    if (!range) throw fail({ instruments: `Za sredstvo ${ticker} ni zgodovinskih podatkov` });
    lo = dayString(range.from) > lo ? dayString(range.from) : lo;
    hi = dayString(range.to) < hi ? dayString(range.to) : hi;
  }
  if (lo > hi) throw fail({ period: 'Izbrana sredstva nimajo skupnega razpona podatkov' });
  if (request.from < lo || request.to > hi) throw fail({ period: `Obdobje mora biti v razponu podatkov: ${lo} do ${hi}` });

  // Preveč svečk zavrnemo, še preden se naložijo v pomnilnik. Štejemo svečke izbranega časovnega okvira.
  const intervalMs = TIMEFRAMES[request.timeframe];
  for (const ticker of request.instruments) {
    const bars = await store.count(ticker, toMs(request.from), toMs(request.to) + DAY_MS, intervalMs);
    if (bars > maxBars) {
      throw fail({ period: `Obdobje za ${ticker} vsebuje ${bars.toLocaleString('sl-SI')} svečk, dovoljenih je največ ${maxBars.toLocaleString('sl-SI')}. Izberite krajše obdobje ali daljši časovni okvir.` });
    }
  }

  const defaults = isObject(strategy.default_params) ? strategy.default_params : {};
  const params = { ...defaults, ...request.params }; // default_params strategije ostanejo nespremenjeni
  const fromMs = toMs(request.from);
  const endMs = toMs(request.to) + DAY_MS; // »do« velja vključno

  // Strategija teče v delavcu za vsako sredstvo; za vsa skupaj velja ena časovna omejitev.
  const assets = [];
  try {
    for (const ticker of request.instruments) {
      const bars = await store.candles(ticker, fromMs, endMs, intervalMs);
      if (bars.length === 0) throw fail({ period: `Za sredstvo ${ticker} ni podatkov v izbranem obdobju` });
      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new StrategyError(`Strategija je presegla časovno omejitev (${deadlineMs / 1000} s)`);
      assets.push({ ticker, trades: await runStrategy(strategy.source, bars, params, { timeoutMs: remaining }) });
    }

    const spreads = new Map<string, number>();
    if (venue.pay_spread) {
      const rows = (await pool.query('SELECT ticker, year, spread FROM spreads WHERE ticker = ANY($1)', [request.instruments])).rows;
      for (const r of rows) spreads.set(`${r.ticker}:${r.year}`, r.spread);
    }
    const spreadFor: SpreadLookup = (ticker, year) => spreads.get(`${ticker}:${year}`);

    const initialCapital = plan ? plan.account_size : request.initialCapital;
    const results = simulate({
      initialCapital,
      from: fromMs,
      to: endMs - 1,
      assets,
      venue: { makerPct: venue.maker_pct, takerPct: venue.taker_pct, paySpread: venue.pay_spread },
      spreadFor,
    });
    const challenge = plan
      ? checkChallenge(
          { accountSize: plan.account_size, profitTarget: plan.profit_target, maxDailyLoss: plan.max_daily_loss, maxTotalLoss: plan.max_total_loss },
          results.equityCurve,
        )
      : undefined;
    return {
      strategyId: Number(strategy.id),
      venueId: request.venueId,
      instruments: request.instruments,
      from: request.from,
      to: request.to,
      params,
      timeframe: request.timeframe,
      initialCapital,
      propPlanId: plan ? request.propPlanId : null,
      challengePassed: challenge ? challenge.passed : null,
      results: { ...results, timeframe: request.timeframe, ...(challenge ? { challenge } : {}) },
    };
  } catch (err) {
    if (err instanceof StrategyError) throw new BacktestError(422, { error: err.message });
    if (err instanceof SimulationError) throw new BacktestError(422, { error: `Strategija je vrnila neveljavne posle: ${err.message}` });
    throw err;
  }
}
