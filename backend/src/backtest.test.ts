import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Pool } from 'pg';
import type { User } from './auth.ts';
import { BacktestError, computeBacktest, INITIAL_CAPITAL } from './backtest.ts';
import { createCandleStore } from './candles.ts';
import { migrate } from './migrate.ts';
import { addUser } from './testApp.ts';
import { writeTestParquet } from './testData.ts';
import { withTestDb } from './testDb.ts';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const JAN1 = Date.UTC(2024, 0, 1);
const BARS = 3 * 1440; // 1.-3. januar 2024, minutne svečke; open = 100 + i, close = 100.5 + i
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

interface Ctx {
  pool: Pool;
  user: User;
  strategyId: (name: string) => Promise<number>;
  run: (input: Record<string, unknown>, timeoutMs?: number, maxBars?: number) => ReturnType<typeof computeBacktest>;
}

// Okolje: migracije, trgovec, Parquet za BTCUSDT, ETHUSDT in EURUSD (3 dni) ter mapa brez podatkov za ostala sredstva.
async function withCtx(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  try {
    for (const ticker of ['BTCUSDT', 'ETHUSDT', 'EURUSD']) await writeTestParquet(dir, ticker, 'a.parquet', JAN1, BARS);
    await writeTestParquet(dir, 'SOLUSDT', 'a.parquet', JAN1 + 1440 * 60_000, 2 * 1440); // podatki od 2. januarja
    await withTestDb(async (pool) => {
      await migrate(pool, MIGRATIONS);
      const email = await addUser(pool, 'trader');
      const row = (await pool.query('SELECT id, email, name, role FROM users WHERE email = $1', [email])).rows[0];
      const user = { ...row, id: Number(row.id) } as User;
      const store = createCandleStore(dir);
      await fn({
        pool,
        user,
        strategyId: async (name) => Number((await pool.query('SELECT id FROM strategies WHERE name = $1', [name])).rows[0].id),
        run: (input, timeoutMs, maxBars) => computeBacktest(pool, store, user, input, { timeoutMs, maxBars }),
      });
    });
  } finally {
    await rm(dir, { recursive: true });
  }
}

const request = async (ctx: Ctx, extra: Record<string, unknown> = {}) => ({
  strategy_id: await ctx.strategyId('Buy & Hold'),
  instruments: ['BTCUSDT'],
  venue_id: 'gross',
  from: '2024-01-01',
  to: '2024-01-03',
  ...extra,
});

const rejection = (promise: Promise<unknown>, status: number, check: (body: any) => void) =>
  assert.rejects(promise, (err) => {
    assert.ok(err instanceof BacktestError, String(err));
    assert.equal(err.status, status);
    check(err.body);
    return true;
  });

test('Buy & Hold čez celotno obdobje: rezultat se ujema z ročnim izračunom', async () => {
  await withCtx(async (ctx) => {
    const r = await ctx.run(await request(ctx));
    // 10000 / 100 = 100 enot; izstop pri 100.5 + 4319 = 4419.5 => bruto (4419.5 - 100) * 100
    near(r.results.grossProfit, 431_950);
    near(r.results.netProfit, 431_950);
    near(r.results.returnPct, (431_950 / INITIAL_CAPITAL) * 100);
    assert.equal(r.results.tradeCount, 1);
    assert.deepEqual(r.results.equityCurve.map((p) => p.date), ['2024-01-01', '2024-01-02', '2024-01-03']);
    assert.deepEqual([r.from, r.to, r.instruments, r.venueId], ['2024-01-01', '2024-01-03', ['BTCUSDT'], 'gross']);
  });
});

test('krajše obdobje uporabi samo svečke v njem (»do« velja vključno)', async () => {
  await withCtx(async (ctx) => {
    const r = await ctx.run(await request(ctx, { from: '2024-01-02' }));
    // prva svečka 2. januarja ima open = 100 + 1440 = 1540
    near(r.results.trades[0]!.entryPrice, 1540);
    near(r.results.grossProfit, ((4419.5 - 1540) * INITIAL_CAPITAL) / 1540);
  });
});

test('parametri za test se združijo s privzetimi in ne spremenijo strategije', async () => {
  await withCtx(async (ctx) => {
    const strategy_id = await ctx.strategyId('SMA Crossover');
    const r = await ctx.run(await request(ctx, { strategy_id, params: { fast: 5 } }));
    assert.deepEqual(r.params, { fast: 5, slow: 30 });
    const row = (await ctx.pool.query('SELECT default_params FROM strategies WHERE id = $1', [strategy_id])).rows[0];
    assert.deepEqual(row.default_params, { fast: 10, slow: 30 });
  });
});

test('zahtevek brez strategije, sredstev, borze ali obdobja je zavrnjen z napakami po poljih', async () => {
  await withCtx(async (ctx) => {
    await rejection(ctx.run({}), 400, (b) => assert.deepEqual(Object.keys(b.errors).sort(), ['from', 'instruments', 'strategy_id', 'to', 'venue_id']));
    await rejection(ctx.run(await request(ctx, { instruments: [] })), 400, (b) => assert.ok(b.errors.instruments));
    await rejection(ctx.run(await request(ctx, { instruments: ['BTCUSDT', 'BTCUSDT'] })), 400, (b) => assert.ok(b.errors.instruments));
    await rejection(ctx.run(await request(ctx, { strategy_id: undefined })), 400, (b) => assert.deepEqual(Object.keys(b.errors), ['strategy_id']));
    await rejection(ctx.run(await request(ctx, { venue_id: '' })), 400, (b) => assert.deepEqual(Object.keys(b.errors), ['venue_id']));
    await rejection(ctx.run(await request(ctx, { from: undefined })), 400, (b) => assert.deepEqual(Object.keys(b.errors), ['from']));
    await rejection(ctx.run(await request(ctx, { to: '2024-02-30' })), 400, (b) => assert.ok(b.errors.to));
    await rejection(ctx.run(await request(ctx, { params: [1] })), 400, (b) => assert.ok(b.errors.params));
  });
});

test('datum »od« mora biti pred datumom »do«', async () => {
  await withCtx(async (ctx) => {
    await rejection(ctx.run(await request(ctx, { from: '2024-01-03', to: '2024-01-01' })), 400, (b) => assert.match(b.errors.to, /pred datumom/));
    await rejection(ctx.run(await request(ctx, { from: '2024-01-02', to: '2024-01-02' })), 400, (b) => assert.match(b.errors.to, /pred datumom/));
  });
});

test('neznana strategija, borza ali sredstvo so zavrnjeni', async () => {
  await withCtx(async (ctx) => {
    await rejection(ctx.run(await request(ctx, { strategy_id: 99999 })), 400, (b) => assert.ok(b.errors.strategy_id));
    await rejection(ctx.run(await request(ctx, { venue_id: 'neobstaja' })), 400, (b) => assert.ok(b.errors.venue_id));
    await rejection(ctx.run(await request(ctx, { instruments: ['NEOBSTAJA'] })), 400, (b) => assert.match(b.errors.instruments, /NEOBSTAJA/));
  });
});

test('obdobje zunaj razpona podatkov vrne veljavni razpon', async () => {
  await withCtx(async (ctx) => {
    for (const bad of [{ from: '2023-12-31' }, { to: '2024-01-04' }]) {
      await rejection(ctx.run(await request(ctx, bad)), 400, (b) => assert.equal(b.errors.period, 'Obdobje mora biti v razponu podatkov: 2024-01-01 do 2024-01-03'));
    }
  });
});

test('več sredstev: razpon je presek, sredstvo brez podatkov je zavrnjeno, kapital se deli enakomerno', async () => {
  await withCtx(async (ctx) => {
    // SOLUSDT ima podatke samo od 2. januarja
    await rejection(ctx.run(await request(ctx, { instruments: ['BTCUSDT', 'SOLUSDT'] })), 400, (b) =>
      assert.equal(b.errors.period, 'Obdobje mora biti v razponu podatkov: 2024-01-02 do 2024-01-03'),
    );
    await rejection(ctx.run(await request(ctx, { instruments: ['BTCUSDT', 'ADAUSDT'] })), 400, (b) => assert.match(b.errors.instruments, /ADAUSDT/));

    const r = await ctx.run(await request(ctx, { instruments: ['BTCUSDT', 'ETHUSDT'] }));
    assert.equal(r.results.tradeCount, 2);
    assert.deepEqual(r.results.trades.map((t) => t.quantity), [50, 50]);
    near(r.results.grossProfit, 431_950); // enaki podatki: 2 * 50 * 4319.5
  });
});

test('stroški borze: enak bruto dobiček, različni stroški (provizija taker)', async () => {
  await withCtx(async (ctx) => {
    const gross = await ctx.run(await request(ctx));
    const futures = await ctx.run(await request(ctx, { venue_id: 'weex-futures' }));
    assert.equal(futures.results.grossProfit, gross.results.grossProfit);
    // taker 0.00055 * 100 enot * (100 + 4419.5)
    near(futures.results.costs.commission, 0.00055 * 100 * (100 + 4419.5));
    assert.equal(gross.results.costs.total, 0);
    near(futures.results.netProfit, futures.results.grossProfit - futures.results.costs.total);
  });
});

test('borza s pay_spread uporabi razpon iz tabele spreads, brez podatka je napaka', async () => {
  await withCtx(async (ctx) => {
    const spread = (await ctx.pool.query("SELECT spread FROM spreads WHERE ticker = 'EURUSD' AND year = 2024")).rows[0].spread as number;
    const r = await ctx.run(await request(ctx, { instruments: ['EURUSD'], venue_id: 'mt5-raw' }));
    near(r.results.costs.spread, spread * 100); // 100 enot
    assert.equal(r.results.costs.commission, 0);

    await rejection(ctx.run(await request(ctx, { venue_id: 'mt5-raw' })), 422, (b) => assert.match(b.error, /Ni podatka o razponu za BTCUSDT v letu 2024/));
  });
});

test('napaka strategije, prekoračen čas in tuja zasebna strategija ne dajo rezultata', async () => {
  await withCtx(async (ctx) => {
    const insert = async (owner: number | null, source: string, visibility = 'private') =>
      Number((await ctx.pool.query("INSERT INTO strategies (owner_id, name, source, visibility) VALUES ($1, 'x', $2, $3) RETURNING id", [owner, source, visibility])).rows[0].id);

    const broken = await insert(ctx.user.id, "export default () => { throw new Error('slab parameter'); }");
    await rejection(ctx.run(await request(ctx, { strategy_id: broken })), 422, (b) => assert.equal(b.error, 'Strategija je vrnila napako: slab parameter'));

    const loop = await insert(ctx.user.id, 'export default () => { while (true) {} }');
    await rejection(ctx.run(await request(ctx, { strategy_id: loop }), 500), 422, (b) => assert.match(b.error, /časovno omejitev/));

    const overlapping = await insert(ctx.user.id, "export default (bars) => [{ side: 'long', entryTime: bars[0].time, exitTime: bars[5].time, entryPrice: 1, exitPrice: 2 }, { side: 'long', entryTime: bars[3].time, exitTime: bars[8].time, entryPrice: 1, exitPrice: 2 }]");
    await rejection(ctx.run(await request(ctx, { strategy_id: overlapping })), 422, (b) => assert.match(b.error, /prekrivata/));

    const other = Number((await ctx.pool.query("INSERT INTO users (email, name, password_hash, role) VALUES ('t2@example.com', 'T2', 'x', 'trader') RETURNING id")).rows[0].id);
    const foreign = await insert(other, 'export default () => []');
    await rejection(ctx.run(await request(ctx, { strategy_id: foreign })), 400, (b) => assert.ok(b.errors.strategy_id));
    const shared = await insert(other, 'export default () => []', 'shared');
    assert.equal((await ctx.run(await request(ctx, { strategy_id: shared }))).results.tradeCount, 0);
  });
});

test('obdobje z preveč svečkami je zavrnjeno, še preden se svečke naložijo, in vrne razumljivo sporočilo', async () => {
  await withCtx(async (ctx) => {
    // 3 dni minutnih svečk = 4320; z omejitvijo 4319 test ne sme steči, z 4320 mora
    await rejection(ctx.run(await request(ctx), undefined, 4319), 400, (b) => {
      assert.match(b.errors.period, /Obdobje za BTCUSDT vsebuje 4\.?320 svečk, dovoljenih je največ 4\.?319\. Izberite krajše obdobje\./);
    });
    assert.equal((await ctx.run(await request(ctx), undefined, 4320)).results.tradeCount, 1);

    // štejejo samo svečke v izbranem obdobju: en dan je 1440 svečk
    assert.equal((await ctx.run(await request(ctx, { from: '2024-01-02' }), undefined, 2880)).results.tradeCount, 1);
  });
});
