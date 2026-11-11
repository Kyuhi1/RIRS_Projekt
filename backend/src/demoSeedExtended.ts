// Razširjeni demo podatki: več mentorjev in trgovcev z realističnimi imeni, lastne strategije, več deset testov
// na BTCUSDT in EURUSD, pregledi s komentarji, ponovitve po zahtevanih popravkih in deljeni testi.
// Vse gre prek javnega API-ja delujoče aplikacije. Skripta je varna za ponovni zagon.
import { call, DEMO_MENTOR, DEMO_PASSWORD, DEMO_TRADER, must } from './demoSeed.ts';

type Person = { name: string; email: string };
const person = (name: string, email: string): Person => ({ name, email });

export const MENTORS = {
  katja: person('Katja Novak', 'katja.novak@example.com'),
  marko: person('Marko Horvat', 'marko.horvat@example.com'),
};
export const TRADERS = {
  luka: person('Luka Kovač', 'luka.kovac@example.com'),
  ana: person('Ana Zupančič', 'ana.zupancic@example.com'),
  jure: person('Jure Potočnik', 'jure.potocnik@example.com'),
  maja: person('Maja Vidmar', 'maja.vidmar@example.com'),
  nejc: person('Nejc Kralj', 'nejc.kralj@example.com'),
  eva: person('Eva Korošec', 'eva.korosec@example.com'),
  tilen: person('Tilen Mlakar', 'tilen.mlakar@example.com'), // povabljen, vabila še ni sprejel
  sara: person('Sara Golob', 'sara.golob@example.com'), // brez mentorja
  rok: person('Rok Zajc', 'rok.zajc@example.com'), // račun je blokiran
};

// Strategije dobijo svečke časovnega okvira, ki ga izbere test (npr. 4 ure), zato jim ni treba same združevati.
const TRADE = `const trade = (side, entry, exit) => ({ side, entryTime: entry.time, exitTime: exit.time, entryPrice: entry.open, exitPrice: exit.open, orderType: 'taker' });
const closeAtEnd = (side, entry, bars) => {
  const last = bars[bars.length - 1];
  return { side, entryTime: entry.time, exitTime: last.time, entryPrice: entry.open, exitPrice: last.close, orderType: 'taker' };
};
`;

const EMA_TREND = `${TRADE}
export default (bars, params) => {
  const { hitra, pocasna } = params;
  if (!(hitra > 0 && pocasna > hitra)) throw new Error('Parametra: pocasna mora biti večja od hitra, oba večja od 0');
  if (bars.length <= pocasna + 1) return [];
  const ema = (n) => {
    const k = 2 / (n + 1);
    let v = bars[0].close;
    return bars.map((x) => (v = x.close * k + v * (1 - k)));
  };
  const f = ema(hitra);
  const s = ema(pocasna);
  const trades = [];
  let entry = null;
  for (let i = pocasna; i < bars.length - 1; i++) {
    const up = f[i] > s[i];
    if (!entry && up) entry = bars[i + 1];
    else if (entry && !up) {
      trades.push(trade('long', entry, bars[i + 1]));
      entry = null;
    }
  }
  if (entry) trades.push(closeAtEnd('long', entry, bars));
  return trades;
};
`;

const RSI_REVERSION = `${TRADE}
export default (bars, params) => {
  const { obdobje, preprodanost, izstop } = params;
  if (!(obdobje > 1 && preprodanost > 0 && izstop > preprodanost)) throw new Error('Parametri: obdobje > 1, 0 < preprodanost < izstop');
  if (bars.length <= obdobje + 2) return [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= obdobje; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= obdobje;
  loss /= obdobje;
  const rsi = new Array(bars.length).fill(50);
  rsi[obdobje] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = obdobje + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    gain = (gain * (obdobje - 1) + Math.max(d, 0)) / obdobje;
    loss = (loss * (obdobje - 1) + Math.max(-d, 0)) / obdobje;
    rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  const trades = [];
  let entry = null;
  for (let i = obdobje + 1; i < bars.length - 1; i++) {
    if (!entry && rsi[i] < preprodanost) entry = bars[i + 1];
    else if (entry && rsi[i] > izstop) {
      trades.push(trade('long', entry, bars[i + 1]));
      entry = null;
    }
  }
  if (entry) trades.push(closeAtEnd('long', entry, bars));
  return trades;
};
`;

const BOLLINGER = `${TRADE}
export default (bars, params) => {
  const { obdobje, odmik } = params;
  if (!(obdobje > 1 && odmik > 0)) throw new Error('Parametra: obdobje > 1, odmik > 0');
  if (bars.length <= obdobje + 2) return [];
  const trades = [];
  let entry = null;
  let side = null;
  for (let i = obdobje; i < bars.length - 1; i++) {
    let sum = 0;
    for (let k = i - obdobje + 1; k <= i; k++) sum += bars[k].close;
    const mid = sum / obdobje;
    let variance = 0;
    for (let k = i - obdobje + 1; k <= i; k++) variance += (bars[k].close - mid) ** 2;
    const band = odmik * Math.sqrt(variance / obdobje);
    const close = bars[i].close;
    if (!entry) {
      if (close < mid - band) { entry = bars[i + 1]; side = 'long'; }
      else if (close > mid + band) { entry = bars[i + 1]; side = 'short'; }
    } else if ((side === 'long' && close >= mid) || (side === 'short' && close <= mid)) {
      trades.push(trade(side, entry, bars[i + 1]));
      entry = null;
    }
  }
  if (entry) trades.push(closeAtEnd(side, entry, bars));
  return trades;
};
`;

const DAILY_BREAKOUT = `${TRADE}
export default (bars, params) => {
  const { obdobje, izstopno_obdobje } = params;
  if (!(obdobje > 0 && izstopno_obdobje > 0)) throw new Error('Parametra obdobje in izstopno_obdobje morata biti večja od 0');
  const trades = [];
  let entry = null;
  for (let i = Math.max(obdobje, izstopno_obdobje); i < bars.length - 1; i++) {
    let hi = -Infinity;
    for (let k = i - obdobje; k < i; k++) hi = Math.max(hi, bars[k].high);
    let lo = Infinity;
    for (let k = i - izstopno_obdobje; k < i; k++) lo = Math.min(lo, bars[k].low);
    if (!entry && bars[i].close > hi) entry = bars[i + 1];
    else if (entry && bars[i].close < lo) {
      trades.push(trade('long', entry, bars[i + 1]));
      entry = null;
    }
  }
  if (entry) trades.push(closeAtEnd('long', entry, bars));
  return trades;
};
`;

interface StrategyDef { owner: keyof typeof TRADERS; name: string; description: string; source: string; params: Record<string, number>; shared: boolean }
const EMA = 'Trend z eksponentnima povprečjema (EMA)';
const RSI = 'Povratek k sredini (RSI)';
const BOLL = 'Povratek k sredini (Bollinger)';
const DAILY = 'Dnevni preboj';
const STRATEGIES: StrategyDef[] = [
  { owner: 'luka', name: EMA, description: 'Nakup, ko hitro eksponentno povprečje preseže počasno; izstop ob obratnem križanju. Primerna za 4-urne svečke.', source: EMA_TREND, params: { hitra: 20, pocasna: 50 }, shared: true },
  { owner: 'ana', name: RSI, description: 'Nakup, ko je RSI pod mejo preprodanosti; izstop, ko se RSI vrne nad izstopno raven. Primerna za urne svečke.', source: RSI_REVERSION, params: { obdobje: 14, preprodanost: 30, izstop: 55 }, shared: true },
  { owner: 'jure', name: BOLL, description: 'Nakup pod spodnjim in prodaja na kratko nad zgornjim Bollingerjevim pasom; izstop ob vrnitvi na sredino. Primerna za urne svečke.', source: BOLLINGER, params: { obdobje: 20, odmik: 2 }, shared: true },
  { owner: 'maja', name: DAILY, description: 'Nakup ob preboju najvišje cene zadnjih 20 dni; izstop pod najnižjo ceno zadnjih 10 dni. Primerna za dnevne svečke.', source: DAILY_BREAKOUT, params: { obdobje: 20, izstopno_obdobje: 10 }, shared: true },
];

const CMT = {
  lateEntry: { body: 'Vstop je prepozen: signal se je pojavil že dve svečki prej, zato je izguba večja, kot bi morala biti.', is_mistake: true },
  riskLimit: { body: 'Največji padec je blizu dovoljene meje financiranega računa. Razmisli o manjši izpostavljenosti.', is_mistake: true },
  overfit: { body: 'Parametri so videti preveč prilagojeni temu obdobju. Preizkusi isto strategijo še na drugem obdobju.', is_mistake: true },
  shortPeriod: { body: 'Rezultat je dober, vendar je obdobje kratko, da bi lahko zaupal številkam.', is_mistake: false },
  goodExit: { body: 'Izstopi so dosledni in se držijo pravil strategije. Tako naprej.', is_mistake: false },
  costs: { body: 'Stroški borze so pojedli velik del dobička. Preveri, ali je toliko poslov res potrebnih.', is_mistake: true },
  fine: { body: 'Pregledano: rezultat je razumljiv in ustreza zastavljenemu cilju.', is_mistake: false },
  rules: { body: 'Pravila financiranega računa so izpolnjena, vendar ob tem ne pozabi na dnevno izgubo.', is_mistake: false },
};
type Comment = (typeof CMT)[keyof typeof CMT];

type Flow = 'draft' | 'submitted' | 'in_review' | 'changes' | 'approved' | 'withdrawn' | 'retested';
interface TestDef {
  trader: keyof typeof TRADERS;
  strategy: string; // sistemska ali lastna strategija (po imenu)
  ticker: 'BTCUSDT' | 'EURUSD';
  venue: string;
  from: string;
  to: string;
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'; // dolžina svečke, ki jo dobi strategija
  capital?: number; // začetni kapital (brez financiranega računa)
  params?: Record<string, number>;
  prop?: string;
  flow: Flow;
  comments?: Comment[];
  share?: boolean;
}

const BTC = 'weex-futures';
const FX = 'mt5-raw';
const NAKUP = 'Nakup in zadrži';
const SMA = 'Presek drsečih povprečij (SMA)';
const DONCHIAN = 'Preboj (Donchian)';
const Y25 = { from: '2025-01-01', to: '2025-12-31' }; // celo leto minutnih podatkov
const TESTS: TestDef[] = [
  // Luka Kovač (mentor: Demo Mentor): aktiven, z več zaključenimi pregledi
  { trader: 'luka', strategy: EMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-01-01', to: '2025-06-30', timeframe: '4h', capital: 25_000, flow: 'approved', comments: [CMT.goodExit], share: true },
  { trader: 'luka', strategy: EMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-07-01', to: '2025-12-31', timeframe: '4h', capital: 25_000, flow: 'submitted' },
  { trader: 'luka', strategy: NAKUP, ticker: 'BTCUSDT', venue: 'gross', ...Y25, timeframe: '1d', capital: 50_000, flow: 'approved', comments: [CMT.fine] },
  { trader: 'luka', strategy: EMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-03-01', to: '2025-05-31', timeframe: '1h', params: { hitra: 10, pocasna: 30 }, flow: 'retested', comments: [CMT.overfit, CMT.costs] },
  { trader: 'luka', strategy: DAILY, ticker: 'BTCUSDT', venue: BTC, ...Y25, timeframe: '1d', flow: 'draft' },
  // Ana Zupančič (mentor: Demo Mentor)
  { trader: 'ana', strategy: RSI, ticker: 'EURUSD', venue: FX, from: '2025-02-01', to: '2025-04-30', timeframe: '1h', capital: 5_000, flow: 'in_review', comments: [CMT.shortPeriod] },
  { trader: 'ana', strategy: RSI, ticker: 'BTCUSDT', venue: BTC, from: '2025-04-01', to: '2025-06-30', timeframe: '1h', flow: 'changes', comments: [CMT.lateEntry, CMT.costs], share: true },
  { trader: 'ana', strategy: SMA, ticker: 'EURUSD', venue: FX, ...Y25, timeframe: '4h', params: { hitro_povprecje: 12, pocasno_povprecje: 48 }, flow: 'submitted' },
  { trader: 'ana', strategy: DONCHIAN, ticker: 'EURUSD', venue: 'prop-cfd', from: '2025-05-01', to: '2025-08-31', timeframe: '1h', params: { obdobje: 24, izstopno_obdobje: 8 }, flow: 'approved', comments: [CMT.goodExit] },
  { trader: 'ana', strategy: NAKUP, ticker: 'EURUSD', venue: FX, ...Y25, timeframe: '1d', flow: 'withdrawn' },
  // Jure Potočnik (mentorica: Katja Novak)
  { trader: 'jure', strategy: BOLL, ticker: 'EURUSD', venue: 'prop-cfd', from: '2025-03-01', to: '2025-06-30', timeframe: '1h', capital: 100_000, flow: 'approved', comments: [CMT.goodExit, CMT.fine] },
  { trader: 'jure', strategy: BOLL, ticker: 'BTCUSDT', venue: BTC, from: '2025-06-01', to: '2025-09-30', timeframe: '1h', flow: 'in_review', comments: [CMT.costs] },
  { trader: 'jure', strategy: DAILY, ticker: 'BTCUSDT', venue: BTC, ...Y25, timeframe: '1d', flow: 'submitted' },
  { trader: 'jure', strategy: EMA, ticker: 'EURUSD', venue: FX, from: '2025-09-01', to: '2025-12-31', timeframe: '4h', flow: 'draft' },
  // Maja Vidmar (mentorica: Katja Novak)
  { trader: 'maja', strategy: DAILY, ticker: 'BTCUSDT', venue: BTC, ...Y25, timeframe: '1d', flow: 'approved', comments: [CMT.fine], share: true },
  { trader: 'maja', strategy: DAILY, ticker: 'BTCUSDT', venue: BTC, from: '2025-04-01', to: '2025-09-30', timeframe: '1d', params: { obdobje: 10, izstopno_obdobje: 5 }, prop: 'topstep-50k', flow: 'changes', comments: [CMT.overfit, CMT.riskLimit] },
  { trader: 'maja', strategy: RSI, ticker: 'EURUSD', venue: FX, from: '2025-06-01', to: '2025-08-31', timeframe: '1h', flow: 'submitted' },
  { trader: 'maja', strategy: NAKUP, ticker: 'BTCUSDT', venue: 'gross', from: '2025-07-01', to: '2025-12-31', timeframe: '1d', flow: 'withdrawn' },
  { trader: 'maja', strategy: EMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-08-01', to: '2025-12-31', timeframe: '4h', flow: 'draft' },
  // Nejc Kralj (mentorica: Katja Novak): začetnik, malo testov
  { trader: 'nejc', strategy: NAKUP, ticker: 'BTCUSDT', venue: 'gross', from: '2025-01-01', to: '2025-03-31', timeframe: '1d', capital: 1_000, flow: 'approved', comments: [CMT.shortPeriod] },
  { trader: 'nejc', strategy: SMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-01-01', to: '2025-03-31', timeframe: '1h', params: { hitro_povprecje: 24, pocasno_povprecje: 96 }, capital: 1_000, flow: 'in_review' },
  { trader: 'nejc', strategy: RSI, ticker: 'BTCUSDT', venue: BTC, from: '2025-05-01', to: '2025-07-31', timeframe: '1h', capital: 1_000, flow: 'draft' },
  // Eva Korošec (mentor: Marko Horvat)
  { trader: 'eva', strategy: EMA, ticker: 'EURUSD', venue: 'prop-cfd', from: '2025-01-01', to: '2025-06-30', timeframe: '4h', prop: 'alpha-pro-100k', flow: 'approved', comments: [CMT.rules, CMT.goodExit] },
  { trader: 'eva', strategy: BOLL, ticker: 'EURUSD', venue: FX, from: '2025-07-01', to: '2025-12-31', timeframe: '1h', flow: 'changes', comments: [CMT.lateEntry] },
  { trader: 'eva', strategy: DAILY, ticker: 'EURUSD', venue: FX, from: '2025-02-01', to: '2025-12-31', timeframe: '1d', flow: 'submitted' },
  { trader: 'eva', strategy: NAKUP, ticker: 'EURUSD', venue: FX, ...Y25, timeframe: '1d', flow: 'in_review' },
  // Rok Zajc (blokiran): njegovi testi ostanejo vidni mentorju
  { trader: 'rok', strategy: NAKUP, ticker: 'BTCUSDT', venue: 'gross', from: '2025-05-01', to: '2025-08-31', timeframe: '1d', flow: 'approved', comments: [CMT.fine] },
  // Sara Golob (brez mentorja): samo lastni osnutki in deljen test
  { trader: 'sara', strategy: EMA, ticker: 'BTCUSDT', venue: BTC, from: '2025-03-01', to: '2025-08-31', timeframe: '4h', flow: 'draft', share: true },
  { trader: 'sara', strategy: SMA, ticker: 'EURUSD', venue: FX, from: '2025-04-01', to: '2025-09-30', timeframe: '4h', params: { hitro_povprecje: 12, pocasno_povprecje: 48 }, flow: 'draft' },
];

// Mentor vsakega trgovca (povezava mora biti aktivna).
const MENTOR_OF: Record<string, Person> = {
  luka: DEMO_MENTOR, ana: DEMO_MENTOR,
  jure: MENTORS.katja, maja: MENTORS.katja, nejc: MENTORS.katja,
  eva: MENTORS.marko, rok: MENTORS.marko,
};

export async function seedDemoExtended(
  base: string,
  log: (message: string) => void = () => undefined,
  admin: { email: string; password: string } = { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'spremeni-me-admin' },
): Promise<number> {
  const sessions = new Map<string, string>();
  const login = async (user: Person, role: string): Promise<string> => {
    const created = must(await call(base, 'POST', '/api/auth/register', null, { ...user, password: DEMO_PASSWORD, role }), [201, 409], `registracija ${user.email}`);
    const session = must(await call(base, 'POST', '/api/auth/login', null, { email: user.email, password: DEMO_PASSWORD }), [200, 403], `prijava ${user.email}`);
    if (created.status === 201) log(`ustvarjen: ${user.name} (${role})`);
    return session.cookie ?? '';
  };

  const mentorCookie = new Map<string, string>([[DEMO_MENTOR.email, await login(DEMO_MENTOR, 'mentor')]]);
  for (const m of Object.values(MENTORS)) mentorCookie.set(m.email, await login(m, 'mentor'));
  for (const [key, t] of Object.entries(TRADERS)) sessions.set(key, await login(t, 'trader'));

  // Povezave: mentor povabi, trgovec sprejme; Tilen vabila še ni sprejel.
  const invite = async (mentor: Person, trader: Person, traderKey: string, accept: boolean) => {
    const cookie = mentorCookie.get(mentor.email)!;
    const links = must(await call(base, 'GET', '/api/mentor-links', cookie), [200], 'povezave').data as { trader: { email: string } }[];
    if (!links.some((l) => l.trader.email === trader.email)) must(await call(base, 'POST', '/api/mentor-links', cookie, { email: trader.email }), [201], 'vabilo');
    if (!accept || !sessions.get(traderKey)) return; // blokiran trgovec se ne more prijaviti, povezava pa že obstaja
    const mine = must(await call(base, 'GET', '/api/mentor-links', sessions.get(traderKey)!), [200], 'povezave trgovca').data as { id: number; status: string }[];
    for (const l of mine.filter((x) => x.status === 'invited')) must(await call(base, 'POST', `/api/mentor-links/${l.id}/accept`, sessions.get(traderKey)!), [200], 'sprejem');
  };
  for (const [key, mentor] of Object.entries(MENTOR_OF)) await invite(mentor, TRADERS[key as keyof typeof TRADERS], key, true);
  await invite(MENTORS.katja, TRADERS.tilen, 'tilen', false);
  log('povezave mentor–trgovec: urejene');

  // Če ima Luka že teste, so bili razširjeni podatki že naloženi.
  const already = must(await call(base, 'GET', '/api/backtests', sessions.get('luka')!), [200], 'testi').data as unknown[];
  if (already.length > 0) {
    log('razširjeni podatki že obstajajo, ničesar ne dodam');
    return 0;
  }

  // Lastne strategije.
  for (const s of STRATEGIES) {
    const cookie = sessions.get(s.owner)!;
    const created = must(await call(base, 'POST', '/api/strategies', cookie, { name: s.name, description: s.description, source: s.source, default_params: s.params }), [201], `strategija ${s.name}`);
    if (s.shared) must(await call(base, 'PUT', `/api/strategies/${created.data.id}/visibility`, cookie, { visibility: 'shared' }), [200], 'deljenje strategije');
    log(`strategija: ${s.name} (${TRADERS[s.owner].name}${s.shared ? ', deljena' : ''})`);
  }

  let created = 0;
  for (const t of TESTS) {
    const trader = sessions.get(t.trader)!;
    const mentor = mentorCookie.get(MENTOR_OF[t.trader]?.email ?? '') ?? '';
    const catalog = must(await call(base, 'GET', '/api/strategies', trader), [200], 'strategije').data as { id: number; name: string; default_params?: Record<string, number> }[];
    const strategy = catalog.find((s) => s.name === t.strategy);
    if (!strategy) throw new Error(`Manjka strategija ${t.strategy}`);
    const own = STRATEGIES.find((s) => s.name === t.strategy);
    const params = t.params ?? own?.params;
    const reply = await call(base, 'POST', '/api/backtests', trader, {
      strategy_id: strategy.id, instruments: [t.ticker], venue_id: t.venue, from: t.from, to: t.to, timeframe: t.timeframe,
      ...(t.capital ? { initial_capital: t.capital } : {}), ...(params ? { params } : {}), ...(t.prop ? { prop_plan_id: t.prop } : {}),
    });
    if (reply.status !== 201) {
      log(`PRESKOČEN test ${t.strategy}/${t.ticker}: ${reply.status} ${JSON.stringify(reply.data)}`);
      continue;
    }
    let id = reply.data.id as number;
    const act = async (who: string, action: string, body?: unknown, target = id) =>
      must(await call(base, 'POST', `/api/backtests/${target}/${action}`, who, body), [200, 201], `${action} #${target}`);
    const review = async (finish: 'approve' | 'request-changes' | null, target = id) => {
      await act(trader, 'submit', undefined, target);
      await act(mentor, 'start-review', undefined, target);
      for (const c of t.comments ?? []) await act(mentor, 'comments', c, target);
      if (finish) await act(mentor, finish, undefined, target);
    };
    switch (t.flow) {
      case 'submitted': await act(trader, 'submit'); break;
      case 'in_review': await review(null); break;
      case 'changes': await review('request-changes'); break;
      case 'approved': await review('approve'); break;
      case 'withdrawn': await act(trader, 'submit'); await act(trader, 'withdraw'); break;
      case 'retested': {
        await review('request-changes');
        // Trgovec popravi test in ga ponovno požene; popravljena različica je odobrena.
        const again = await act(trader, 'retest', {});
        id = again.data.id as number;
        await act(trader, 'submit');
        await act(mentor, 'start-review');
        await act(mentor, 'comments', CMT.fine);
        await act(mentor, 'approve');
        break;
      }
      default: break;
    }
    if (t.share) must(await call(base, 'PUT', `/api/backtests/${id}/visibility`, trader, { visibility: 'shared' }), [200], 'deljenje testa');
    created++;
    log(`test #${id}: ${TRADERS[t.trader].name}, ${t.strategy}, ${t.ticker}, ${t.flow}`);
  }

  // Blokiran račun (samo z administratorskim računom iz .env).
  const adminSession = await call(base, 'POST', '/api/auth/login', null, admin);
  if (adminSession.status === 200) {
    const found = must(await call(base, 'GET', `/api/admin/users?q=${encodeURIComponent(TRADERS.rok.email)}`, adminSession.cookie), [200], 'iskanje uporabnika').data.items as { id: number }[];
    if (found[0]) must(await call(base, 'PATCH', `/api/admin/users/${found[0].id}`, adminSession.cookie, { blocked: true }), [200], 'blokada');
    log(`blokiran račun: ${TRADERS.rok.email}`);
  } else {
    log('administratorska prijava ni uspela, blokade računa ne nastavim');
  }
  return created;
}
