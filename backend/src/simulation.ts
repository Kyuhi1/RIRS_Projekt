// Simulator: iz poslov strategije izračuna metrike in dnevno krivuljo vrednosti računa.
// Definicije so v README (poglavje »Simulacija«).

export interface Trade {
  side: 'long' | 'short';
  entryTime: number; // ms od 1970 (UTC)
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
}

export interface AssetTrades {
  ticker: string;
  trades: Trade[];
}

export interface SimulationInput {
  initialCapital: number;
  from: number; // začetek obdobja, ms (UTC)
  to: number; // konec obdobja, ms (UTC)
  assets: AssetTrades[];
}

export interface TradeResult extends Trade {
  ticker: string;
  quantity: number;
  grossProfit: number;
  netProfit: number;
}

export interface EquityPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number;
}

export interface SimulationResult {
  initialCapital: number;
  finalCapital: number;
  grossProfit: number;
  netProfit: number;
  returnPct: number;
  tradeCount: number;
  winRatePct: number;
  maxDrawdownPct: number;
  equityCurve: EquityPoint[];
  trades: TradeResult[];
}

export class SimulationError extends Error {}

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => Math.floor(ms / DAY_MS);
const isoDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function validate(input: SimulationInput): void {
  const { initialCapital, from, to, assets } = input;
  if (!(initialCapital > 0)) throw new SimulationError('Začetni kapital mora biti večji od 0');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new SimulationError('Neveljavno obdobje');
  if (assets.length === 0) throw new SimulationError('Izberite vsaj eno sredstvo');
  if (new Set(assets.map((a) => a.ticker)).size !== assets.length) throw new SimulationError('Sredstvo je podvojeno');

  for (const { ticker, trades } of assets) {
    let previousExit = -Infinity;
    for (const t of trades) {
      if (t.side !== 'long' && t.side !== 'short') throw new SimulationError(`${ticker}: neveljavna smer posla`);
      if (![t.entryTime, t.exitTime].every(Number.isFinite) || t.exitTime < t.entryTime) {
        throw new SimulationError(`${ticker}: neveljaven čas posla`);
      }
      if (!(t.entryPrice > 0) || !(t.exitPrice > 0)) throw new SimulationError(`${ticker}: cena posla mora biti večja od 0`);
      if (t.entryTime < from || t.exitTime > to) throw new SimulationError(`${ticker}: posel je zunaj obdobja testa`);
      if (t.entryTime < previousExit) throw new SimulationError(`${ticker}: posla se prekrivata`);
      previousExit = t.exitTime;
    }
  }
}

export function simulate(input: SimulationInput): SimulationResult {
  validate(input);
  const { initialCapital, from, to, assets } = input;
  const perAsset = initialCapital / assets.length; // enakomerna delitev kapitala

  const results: TradeResult[] = [];
  // Sprememba stanja po dnevih izstopa, za vsako sredstvo posebej.
  const deltas: Map<number, number>[] = [];

  for (const { ticker, trades } of assets) {
    const byDay = new Map<number, number>();
    deltas.push(byDay);
    let balance = perAsset;

    for (const t of [...trades].sort((a, b) => a.entryTime - b.entryTime)) {
      if (balance <= 0) break; // kapital sredstva je porabljen, naprej ne trguje
      const quantity = balance / t.entryPrice; // celoten kapital sredstva, brez vzvoda
      const direction = t.side === 'long' ? 1 : -1;
      const grossProfit = direction * (t.exitPrice - t.entryPrice) * quantity;
      const netProfit = grossProfit;

      balance += netProfit;
      const day = dayOf(t.exitTime);
      byDay.set(day, (byDay.get(day) ?? 0) + netProfit);
      results.push({ ...t, ticker, quantity, grossProfit, netProfit });
    }
  }

  // Dnevna krivulja: vsota stanj po sredstvih na konec vsakega dne obdobja.
  const balances = assets.map(() => perAsset);
  const equityCurve: EquityPoint[] = [];
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  for (let day = dayOf(from); day <= dayOf(to); day++) {
    deltas.forEach((byDay, i) => {
      balances[i]! += byDay.get(day) ?? 0;
    });
    const value = balances.reduce((a, b) => a + b, 0);
    equityCurve.push({ date: isoDate(day), value });
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - value) / peak) * 100);
  }

  const grossProfit = results.reduce((sum, t) => sum + t.grossProfit, 0);
  const netProfit = results.reduce((sum, t) => sum + t.netProfit, 0);
  const winners = results.filter((t) => t.netProfit > 0).length;

  return {
    initialCapital,
    finalCapital: initialCapital + netProfit,
    grossProfit,
    netProfit,
    returnPct: (netProfit / initialCapital) * 100,
    tradeCount: results.length,
    winRatePct: results.length ? (winners / results.length) * 100 : 0,
    maxDrawdownPct,
    equityCurve,
    trades: results,
  };
}
