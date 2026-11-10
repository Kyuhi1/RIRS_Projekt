import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candle } from './candles.ts';
import { runStrategy, StrategyError } from './strategy.ts';

const bar = (i: number, close: number): Candle => ({ time: Date.UTC(2024, 0, 1 + i), open: close, high: close, low: close, close, volume: 1 });
const BARS = [bar(0, 100), bar(1, 110), bar(2, 120)];

const rejectsWith = (source: string, pattern: RegExp, params: unknown = {}) =>
  assert.rejects(runStrategy(source, BARS, params), (err) => err instanceof StrategyError && pattern.test(err.message));

test('pravilna strategija dobi svečke in parametre ter vrne posle', async () => {
  const source = `export default (bars, params) => [{
    side: params.side,
    entryTime: bars[0].time,
    exitTime: bars[bars.length - 1].time,
    entryPrice: bars[0].close,
    exitPrice: bars[bars.length - 1].close,
    orderType: 'maker',
  }];`;
  const trades = await runStrategy(source, BARS, { side: 'long' });
  assert.deepEqual(trades, [
    { side: 'long', entryTime: BARS[0]!.time, exitTime: BARS[2]!.time, entryPrice: 100, exitPrice: 120, orderType: 'maker' },
  ]);
});

test('podprta je tudi »export default function« in strategija brez poslov', async () => {
  assert.deepEqual(await runStrategy('export default function (bars) { return []; }', BARS, {}), []);
});

test('napaka v strategiji vrne razumljiv razlog brez sledi sklada', async () => {
  await assert.rejects(
    runStrategy("export default () => { throw new Error('slab parameter'); }", BARS, {}),
    (err) => err instanceof StrategyError && err.message === 'Strategija je vrnila napako: slab parameter' && !/\bat\b.*:\d+/.test(err.message),
  );
  await rejectsWith('export default () => null.x', /Cannot read properties of null/);
});

test('sintaksna napaka, manjkajoč export default in napačen izhod so razumljive napake', async () => {
  await rejectsWith('export default (bars => {', /Napaka v kodi strategije/);
  await rejectsWith('const x = 1;', /export default/);
  await rejectsWith('export default () => 42', /seznam poslov/);
  await rejectsWith('export default async () => []', /seznam poslov/);
});
