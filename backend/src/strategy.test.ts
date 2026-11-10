import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candle } from './candles.ts';
import { runStrategy, StrategyError, type RunOptions } from './strategy.ts';

const bar = (i: number, close: number): Candle => ({ time: Date.UTC(2024, 0, 1 + i), open: close, high: close, low: close, close, volume: 1 });
const BARS = [bar(0, 100), bar(1, 110), bar(2, 120)];

const rejectsWith = (source: string, pattern: RegExp, params: unknown = {}, options: RunOptions = {}) =>
  assert.rejects(runStrategy(source, BARS, params, options), (err) => err instanceof StrategyError && pattern.test(err.message));
const GOOD = 'export default () => [];';

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

test('neskončna zanka se prekine po časovni omejitvi in backend teče naprej', async () => {
  const started = Date.now();
  await rejectsWith('export default () => { while (true) {} }', /časovno omejitev/, {}, { timeoutMs: 300 });
  assert.ok(Date.now() - started < 3_000);
  assert.deepEqual(await runStrategy(GOOD, BARS, {}), []);
});

test('zanka v obljubah in zlonamerna napaka z getterjem sta prav tako prekinjeni', async () => {
  await rejectsWith('export default () => { (function loop() { Promise.resolve().then(loop); })(); return []; }', /časovno omejitev/, {}, { timeoutMs: 300 });
  await rejectsWith('export default () => { throw { get message() { while (true); } }; }', /časovno omejitev/, {}, { timeoutMs: 300 });
});

test('sporočilo o časovni omejitvi navede mejo', async () => {
  await rejectsWith('export default () => { while (true) {} }', /\(0\.3 s\)/, {}, { timeoutMs: 300 });
});

test('prekoračitev pomnilnika prekine samo delavca, backend teče naprej', async () => {
  const hog = 'export default () => { const a = []; while (true) a.push(new Array(100000).fill(1)); }';
  await rejectsWith(hog, /pomnilniško omejitev \(32 MB\)/, {}, { memoryMb: 32, timeoutMs: 20_000 });
  assert.deepEqual(await runStrategy(GOOD, BARS, {}), []);
});

// Izolacija: strategija ne sme doseči process, require, fetch, datotek ali baze.
test('strategija nima dostopa do process, require, fetch, časovnikov in modulov', async () => {
  const names = ['process', 'require', 'fetch', 'setTimeout', 'setImmediate', 'Buffer', 'module', 'exports', '__dirname', 'global'];
  const source = `export default () => [{ types: [${names.map((n) => `typeof ${n}`).join(', ')}] }]`;
  const [result] = (await runStrategy(source, BARS, {})) as unknown as { types: string[] }[];
  assert.deepEqual(result!.types, names.map(() => 'undefined'));

  await rejectsWith("export default () => { require('fs').readFileSync('/etc/passwd'); return []; }", /require is not defined/);
  await rejectsWith('export default () => { process.env.DATABASE_URL; return []; }', /process is not defined/);
  await rejectsWith("export default () => { fetch('http://example.com'); return []; }", /fetch is not defined/);
});

test('statični import modulov v strategiji ni mogoč', async () => {
  await rejectsWith("import fs from 'node:fs'; export default () => [];", /Napaka v kodi strategije/);
});

test('poskusi pobega prek konstruktorjev in podanih podatkov ne uspejo', async () => {
  const escapes = [
    "this.constructor.constructor('return process')()",
    "[].constructor.constructor('return process')()",
    "(() => {}).constructor('return process')()",
    "bars.constructor.constructor('return process')()",
    "params.constructor.constructor('return process')()",
    "Object.getPrototypeOf(bars).constructor.constructor('return process')()",
    "eval('process')",
    "new Function('return process')()",
  ];
  for (const escape of escapes) {
    await assert.rejects(
      runStrategy(`export default (bars, params) => { const p = ${escape}; return [p.version]; }`, BARS, { a: 1 }),
      (err) => err instanceof StrategyError,
      escape,
    );
  }
});

test('strategija ne more spremeniti podatkov delavca ali vplivati na naslednji zagon', async () => {
  await runStrategy('export default (bars) => { bars.length = 0; Object.prototype.hacked = 1; Array.prototype.push = null; return []; }', BARS, {});
  assert.equal((Object.prototype as Record<string, unknown>).hacked, undefined);
  assert.equal(BARS.length, 3);
  assert.deepEqual(await runStrategy('export default (bars) => [{ n: bars.length, h: typeof ({}).hacked }]', BARS, {}) as unknown[], [{ n: 3, h: 'undefined' }]);
});

test('delavec ne uvaža modulov backenda in zato nima povezave z bazo ali datotekami', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./strategyWorker.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['node:vm', 'node:worker_threads']);
});
