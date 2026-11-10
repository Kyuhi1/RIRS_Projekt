import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkChallenge, type PropPlan } from './propRules.ts';
import type { EquityPoint } from './simulation.ts';

// Račun 100.000, cilj 10.000, največja dnevna izguba 5.000, največja skupna izguba 10.000.
const PLAN: PropPlan = { accountSize: 100_000, profitTarget: 10_000, maxDailyLoss: 5_000, maxTotalLoss: 10_000 };
const curve = (...values: number[]): EquityPoint[] => values.map((value, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, value }));

test('vsa pravila izpolnjena: cilj dosežen, izgube v mejah', () => {
  const r = checkChallenge(PLAN, curve(101_000, 99_000, 103_000, 110_500));
  assert.equal(r.passed, true);
  assert.deepEqual(r.profitTarget, { achieved: 10_500, allowed: 10_000, passed: true, firstViolation: null });
  assert.deepEqual(r.maxDailyLoss, { achieved: 2_000, allowed: 5_000, passed: true, firstViolation: null }); // 101.000 -> 99.000
  assert.deepEqual(r.maxTotalLoss, { achieved: 1_000, allowed: 10_000, passed: true, firstViolation: null }); // najnižje 99.000
});

test('kršena dnevna izguba: datum prve kršitve, test teče do konca, izid je neuspešen', () => {
  // 3. dan pade z 104.000 na 98.000 (izguba 6.000 > 5.000), 5. dan še ena večja, a prva kršitev je 3. dan
  const r = checkChallenge(PLAN, curve(102_000, 104_000, 98_000, 104_000, 96_500, 112_000));
  assert.deepEqual(r.maxDailyLoss, { achieved: 7_500, allowed: 5_000, passed: false, firstViolation: '2024-01-03' });
  assert.equal(r.maxTotalLoss.passed, true); // skupno nikoli pod 90.000
  assert.equal(r.profitTarget.passed, true); // konec 112.000: cilj bi bil dosežen
  assert.equal(r.passed, false); // dovolj je ena kršitev
});

test('kršena skupna izguba: datum prve kršitve in največja skupna izguba', () => {
  // padec po manjših korakih (dnevna izguba nikoli > 5.000), skupno pa pod 90.000 šele 4. dan
  const r = checkChallenge(PLAN, curve(97_000, 94_000, 91_000, 88_000, 95_000, 120_000));
  assert.deepEqual(r.maxTotalLoss, { achieved: 12_000, allowed: 10_000, passed: false, firstViolation: '2024-01-04' });
  assert.equal(r.maxDailyLoss.passed, true);
  assert.deepEqual([r.maxDailyLoss.achieved, r.maxDailyLoss.firstViolation], [3_000, null]);
  assert.equal(r.profitTarget.passed, true);
  assert.equal(r.passed, false);
});

test('cilj ni dosežen: pravili o izgubi izpolnjeni, izid neuspešen', () => {
  const r = checkChallenge(PLAN, curve(100_500, 102_000, 104_000, 109_999.99));
  assert.deepEqual(r.profitTarget, { achieved: 9_999.99, allowed: 10_000, passed: false, firstViolation: null });
  assert.equal(r.maxDailyLoss.passed && r.maxTotalLoss.passed, true);
  assert.equal(r.passed, false);
});

test('mejne vrednosti: izguba točno enaka dovoljeni še ni kršitev, cilj točno dosežen je izpolnjen', () => {
  const r = checkChallenge(PLAN, curve(105_000, 100_000, 90_000 + 20_000)); // dnevna izguba 5.000, skupna nikoli 10.000
  assert.equal(r.maxDailyLoss.passed, true);
  assert.equal(r.maxDailyLoss.achieved, 5_000);
  assert.equal(r.profitTarget.passed, true); // točno 10.000
  const edge = checkChallenge(PLAN, curve(90_000, 110_000)); // skupna izguba točno 10.000
  assert.equal(edge.maxTotalLoss.passed, true);
  assert.equal(checkChallenge(PLAN, curve(89_999.99, 110_000)).maxTotalLoss.passed, false); // za cent več
});

test('prvi dan se dnevna izguba meri od začetnega stanja računa', () => {
  const r = checkChallenge(PLAN, curve(94_000, 120_000));
  assert.deepEqual([r.maxDailyLoss.passed, r.maxDailyLoss.firstViolation, r.maxDailyLoss.achieved], [false, '2024-01-01', 6_000]);
});

test('zaokroževanje na cente ne ustvari lažnih kršitev zaradi plavajoče vejice', () => {
  const r = checkChallenge(PLAN, curve(100_000.1 + 0.2, 95_000.3 - 0.0000001, 110_000));
  assert.equal(r.maxDailyLoss.passed, true); // izguba 5000.0000001, zaokrožena 5000.00
  assert.equal(r.maxDailyLoss.achieved, 5_000);
});

test('različna načrta na isti krivulji dasta različna izida', () => {
  const same = curve(98_000, 94_000, 112_000); // dnevna izguba 4.000, skupna do 6.000, dobiček 12.000
  const loose = checkChallenge({ accountSize: 100_000, profitTarget: 10_000, maxDailyLoss: 5_000, maxTotalLoss: 10_000 }, same);
  const strict = checkChallenge({ accountSize: 100_000, profitTarget: 10_000, maxDailyLoss: 3_000, maxTotalLoss: 5_000 }, same);
  assert.equal(loose.passed, true);
  assert.equal(strict.passed, false);
  assert.deepEqual([strict.maxDailyLoss.passed, strict.maxTotalLoss.passed], [false, false]);
});

test('prazna krivulja: nič ni doseženo, cilj ni izpolnjen', () => {
  const r = checkChallenge(PLAN, []);
  assert.deepEqual([r.profitTarget.achieved, r.profitTarget.passed, r.maxDailyLoss.passed, r.maxTotalLoss.passed, r.passed], [0, false, true, true, false]);
});
