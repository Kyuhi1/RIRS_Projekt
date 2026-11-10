import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate, SimulationError, type SpreadLookup, type Trade, type Venue } from './simulation.ts';

const day = (d: number, hour = 9) => Date.UTC(2024, 0, d, hour);
const FROM = day(1, 0);
const TO = day(5, 23);
const trade = (side: 'long' | 'short', entry: number, exit: number, entryDay: number, exitDay: number): Trade => ({
  side,
  entryTime: day(entryDay),
  exitTime: day(exitDay),
  entryPrice: entry,
  exitPrice: exit,
});
const GROSS: Venue = { makerPct: 0, takerPct: 0, paySpread: false };
const NO_SPREADS: SpreadLookup = () => undefined;
const run = (trades: Trade[], venue: Venue = GROSS, spreadFor: SpreadLookup = NO_SPREADS) =>
  simulate({ initialCapital: 10_000, from: FROM, to: TO, assets: [{ ticker: 'A', trades }], venue, spreadFor });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('long posel: celoten kapital kupi sredstvo, dobiček = razlika cen * količina', () => {
  // kapital 10000 / cena 100 = 100 enot; (110 - 100) * 100 = 1000
  const r = run([trade('long', 100, 110, 1, 2)]);
  assert.equal(r.trades[0]!.quantity, 100);
  near(r.grossProfit, 1000);
  near(r.netProfit, 1000);
  near(r.returnPct, 10);
  near(r.finalCapital, 11_000);
  assert.equal(r.tradeCount, 1);
});

test('short posel: dobiček, ko cena pade, izguba, ko zraste', () => {
  near(run([trade('short', 100, 90, 1, 2)]).netProfit, 1000);
  near(run([trade('short', 100, 105, 1, 2)]).netProfit, -500);
});

test('več poslov: vsak posel uporabi celoten kapital sredstva, metrike se ujemajo z ročnim izračunom', () => {
  // T1: 100 -> 110, 10000 / 100 = 100 enot, +1000 (stanje 11000)
  // T2: 110 -> 99, 10000 / 110 enot, -1000 (stanje 10000)
  // T3: 99 -> 108.9, 10000 / 99 enot, +1000 (stanje 11000)
  const r = run([trade('long', 100, 110, 1, 2), trade('long', 110, 99, 2, 3), trade('long', 99, 108.9, 3, 4)]);
  near(r.netProfit, 1000);
  near(r.returnPct, 10);
  assert.equal(r.tradeCount, 3);
  near(r.winRatePct, (2 / 3) * 100);
  near(r.maxDrawdownPct, (1000 / 11_000) * 100); // vrh 11000, dno 10000
});

test('dnevna krivulja zajame celotno obdobje in prenaša stanje na dneve brez poslov', () => {
  const r = run([trade('long', 100, 110, 1, 2), trade('long', 110, 99, 2, 3), trade('long', 99, 108.9, 3, 4)]);
  assert.deepEqual(
    r.equityCurve.map((p) => p.date),
    ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'],
  );
  const values = [10_000, 11_000, 10_000, 11_000, 11_000];
  r.equityCurve.forEach((p, i) => near(p.value, values[i]!));
});

test('brez poslov: nič dobička, ravna krivulja, delež dobičkonosnih 0', () => {
  const r = run([]);
  assert.equal(r.tradeCount, 0);
  assert.equal(r.netProfit, 0);
  assert.equal(r.winRatePct, 0);
  assert.equal(r.maxDrawdownPct, 0);
  assert.ok(r.equityCurve.every((p) => p.value === 10_000));
});

test('več sredstev: kapital se enakomerno razdeli, krivulja je vsota sredstev', () => {
  // vsako sredstvo dobi 5000; A: 100 -> 110 (50 enot, +500), B: short 200 -> 190 (25 enot, +250)
  const r = simulate({
    initialCapital: 10_000,
    from: FROM,
    to: TO,
    assets: [
      { ticker: 'A', trades: [trade('long', 100, 110, 1, 2)] },
      { ticker: 'B', trades: [trade('short', 200, 190, 1, 3)] },
    ],
    venue: GROSS,
    spreadFor: NO_SPREADS,
  });
  assert.deepEqual(r.trades.map((t) => t.quantity), [50, 25]);
  near(r.grossProfit, 750);
  near(r.returnPct, 7.5);
  assert.equal(r.tradeCount, 2);
  const values = [10_000, 10_500, 10_750, 10_750, 10_750]; // A na dan 2, B na dan 3
  r.equityCurve.forEach((p, i) => near(p.value, values[i]!));
});

test('neveljavni podatki so zavrnjeni', () => {
  const ok = trade('long', 100, 110, 1, 2);
  assert.throws(() => simulate({ initialCapital: 0, from: FROM, to: TO, assets: [{ ticker: 'A', trades: [] }], venue: GROSS, spreadFor: NO_SPREADS }), SimulationError);
  assert.throws(() => simulate({ initialCapital: 1, from: FROM, to: TO, assets: [], venue: GROSS, spreadFor: NO_SPREADS }), SimulationError);
  assert.throws(() => run([{ ...ok, side: 'buy' as never }]), /smer/);
  assert.throws(() => run([{ ...ok, entryPrice: 0 }]), /cena/);
  assert.throws(() => run([{ ...ok, exitTime: ok.entryTime - 1 }]), /čas/);
  assert.throws(() => run([trade('long', 100, 110, 1, 9)]), /zunaj obdobja/);
  assert.throws(() => run([trade('long', 100, 110, 1, 3), trade('long', 100, 110, 2, 4)]), /prekrivata/);
});

// Stroški borze. Posel: long 100 -> 110, 100 enot; vrednost ob vstopu 10000, ob izstopu 11000, skupaj 21000.
const FEES: Venue = { makerPct: 0.001, takerPct: 0.002, paySpread: false };
const long = (orderType?: 'maker' | 'taker') => ({ ...trade('long', 100, 110, 1, 2), orderType });

test('provizija po taker_pct pri taker in privzeto: 0.002 * 21000 = 42', () => {
  for (const orderType of ['taker', undefined] as const) {
    const r = run([long(orderType)], FEES);
    near(r.costs.commission, 42);
    near(r.netProfit, 958);
  }
});

test('provizija po maker_pct pri maker: 0.001 * 21000 = 21', () => {
  const r = run([long('maker')], FEES);
  near(r.costs.commission, 21);
  near(r.netProfit, 979);
});

test('pri pay_spread = true se upošteva razpon (0.5 * 100 enot = 50), pri false ne', () => {
  const spreadFor: SpreadLookup = (ticker, year) => (ticker === 'A' && year === 2024 ? 0.5 : undefined);
  const withSpread = run([long()], { makerPct: 0, takerPct: 0, paySpread: true }, spreadFor);
  near(withSpread.costs.spread, 50);
  near(withSpread.netProfit, 950);

  const without = run([long()], { makerPct: 0, takerPct: 0, paySpread: false }, spreadFor);
  assert.equal(without.costs.spread, 0);
  near(without.netProfit, 1000);
});

test('provizija in razpon se seštejeta; razpon se plača pri vsakem poslu', () => {
  // dva posla: 100 -> 110 (100 enot), nato 110 -> 121 (10000 / 110 enot)
  const spreadFor: SpreadLookup = () => 1;
  const venue: Venue = { makerPct: 0.001, takerPct: 0.002, paySpread: true };
  const r = run([long('maker'), { ...trade('long', 110, 121, 2, 3), orderType: 'taker' }], venue, spreadFor);
  // T1: bruto 1000, provizija 0.001 * 100 * 210 = 21, razpon 1 * 100 = 100, neto 879
  // T2: q = 10000 / 110, bruto 11 * q, provizija 0.002 * q * 231, razpon 1 * q
  const q2 = 10_000 / 110;
  near(r.trades[1]!.quantity, q2);
  near(r.costs.commission, 21 + 0.002 * q2 * 231);
  near(r.costs.spread, 100 + q2);
  near(r.netProfit, r.grossProfit - r.costs.total);
});

test('borza brez stroškov: stroški 0, bruto in neto dobiček sta enaka', () => {
  const r = run([trade('long', 100, 110, 1, 2), trade('short', 110, 100, 2, 3)], { makerPct: 0, takerPct: 0, paySpread: false });
  assert.equal(r.costs.total, 0);
  assert.equal(r.netProfit, r.grossProfit);
});

test('isti test z dvema borzama: enak bruto dobiček, različni stroški', () => {
  const trades = [trade('long', 100, 110, 1, 2), trade('short', 110, 104, 2, 3)];
  const cheap = run(trades, { makerPct: 0.0001, takerPct: 0.0002, paySpread: false });
  const dear = run(trades, { makerPct: 0.001, takerPct: 0.002, paySpread: false });
  assert.equal(cheap.grossProfit, dear.grossProfit);
  assert.ok(cheap.costs.total > 0 && dear.costs.total > cheap.costs.total);
  assert.ok(dear.netProfit < cheap.netProfit);
});

test('stroški zmanjšajo stanje na krivulji in vplivajo na donosnost, delež dobičkonosnih in padec', () => {
  // posel 100 -> 100.5 je bruto dobičkonosen (+50), a po proviziji 0.002 * 100 * 200.5 = 40.1... ostane +9.9
  const small = run([trade('long', 100, 100.5, 1, 2)], FEES);
  near(small.netProfit, 50 - 0.002 * 100 * 200.5);
  assert.equal(small.winRatePct, 100);
  // posel 100 -> 100.1 postane po stroških izguba
  const loss = run([trade('long', 100, 100.1, 1, 2)], FEES);
  assert.ok(loss.grossProfit > 0 && loss.netProfit < 0);
  assert.equal(loss.winRatePct, 0);
  near(loss.equityCurve[1]!.value, 10_000 + loss.netProfit);
  assert.ok(loss.maxDrawdownPct > 0);
});

test('manjkajoč razpon pri borzi s pay_spread je napaka, neveljavna vrsta naročila je zavrnjena', () => {
  const spreadVenue: Venue = { makerPct: 0, takerPct: 0, paySpread: true };
  assert.throws(() => run([long()], spreadVenue), /Ni podatka o razponu za A v letu 2024/);
  assert.throws(() => run([{ ...long(), orderType: 'market' as never }], FEES), /vrsta naročila/);
  assert.throws(() => run([long()], { makerPct: -1, takerPct: 0, paySpread: false }), /negativna/);
});
