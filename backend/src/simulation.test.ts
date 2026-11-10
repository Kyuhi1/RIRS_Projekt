import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulate, SimulationError, type Trade } from './simulation.ts';

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
const run = (trades: Trade[]) => simulate({ initialCapital: 10_000, from: FROM, to: TO, assets: [{ ticker: 'A', trades }] });
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

test('več poslov: kapital se prenaša, metrike pa se ujemajo z ročnim izračunom', () => {
  // T1: 100 -> 110, 100 enot, +1000 (stanje 11000)
  // T2: 110 -> 99, 11000 / 110 = 100 enot, -1100 (stanje 9900)
  // T3: 99 -> 108.9, 9900 / 99 = 100 enot, +990 (stanje 10890)
  const r = run([trade('long', 100, 110, 1, 2), trade('long', 110, 99, 2, 3), trade('long', 99, 108.9, 3, 4)]);
  near(r.netProfit, 890);
  near(r.returnPct, 8.9);
  assert.equal(r.tradeCount, 3);
  near(r.winRatePct, (2 / 3) * 100);
  near(r.maxDrawdownPct, 10); // vrh 11000, dno 9900: (11000 - 9900) / 11000
});

test('dnevna krivulja zajame celotno obdobje in prenaša stanje na dneve brez poslov', () => {
  const r = run([trade('long', 100, 110, 1, 2), trade('long', 110, 99, 2, 3), trade('long', 99, 108.9, 3, 4)]);
  assert.deepEqual(
    r.equityCurve.map((p) => p.date),
    ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'],
  );
  const values = [10_000, 11_000, 9_900, 10_890, 10_890];
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
  assert.throws(() => simulate({ initialCapital: 0, from: FROM, to: TO, assets: [{ ticker: 'A', trades: [] }] }), SimulationError);
  assert.throws(() => simulate({ initialCapital: 1, from: FROM, to: TO, assets: [] }), SimulationError);
  assert.throws(() => run([{ ...ok, side: 'buy' as never }]), /smer/);
  assert.throws(() => run([{ ...ok, entryPrice: 0 }]), /cena/);
  assert.throws(() => run([{ ...ok, exitTime: ok.entryTime - 1 }]), /čas/);
  assert.throws(() => run([trade('long', 100, 110, 1, 9)]), /zunaj obdobja/);
  assert.throws(() => run([trade('long', 100, 110, 1, 3), trade('long', 100, 110, 2, 4)]), /prekrivata/);
});
