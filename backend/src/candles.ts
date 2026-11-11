import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

export interface Candle {
  time: number; // začetek svečke, ms od 1970 (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const BASE_INTERVAL_MS = 60_000; // podatki so minutne svečke

export interface DataRange {
  from: string; // ISO čas prve svečke
  to: string; // ISO čas zadnje svečke
  candles: number;
}

export interface CandleStore {
  range(ticker: string): Promise<DataRange | null>;
  // `intervalMs` je dolžina svečke v ms: 60.000 (privzeto) vrne izvirne minutne svečke, večja vrednost jih združi
  // v daljše svečke (open = prva, high = največ, low = najmanj, close = zadnja, volume = vsota), poravnane na UTC.
  candles(ticker: string, fromMs: number, toMs: number, intervalMs?: number): Promise<Candle[]>;
  count(ticker: string, fromMs: number, toMs: number, intervalMs?: number): Promise<number>; // število svečk v [fromMs, toMs), brez nalaganja
}

// Podatki so v <dataDir>/<TICKER>/*.parquet, npr. data/BTCUSDT/2024-01.parquet.
// Stolpci: open_time (BIGINT, ms UTC), open, high, low, close, volume.
export function createCandleStore(dataDir: string): CandleStore {
  let instance: Promise<DuckDBInstance> | undefined;

  async function query(sql: string, values: (string | number)[]) {
    instance ??= DuckDBInstance.create(':memory:');
    const connection = await (await instance).connect();
    try {
      return (await connection.runAndReadAll(sql, values)).getRowObjects();
    } finally {
      connection.closeSync();
    }
  }

  // Vrne vzorec za vse Parquet datoteke sredstva ali null, če podatkov ni.
  async function filesOf(ticker: string): Promise<string | null> {
    // ticker pride iz zahtevka, zato samo oblika BTCUSDT ali BTCUSDT.P (brez poti)
    if (!/^[A-Z0-9]+(\.P)?$/.test(ticker)) throw new Error(`Neveljaven ticker: ${ticker}`);
    const dir = join(dataDir, ticker);
    try {
      const files = await readdir(dir);
      return files.some((f) => f.endsWith('.parquet')) ? join(dir, '*.parquet') : null;
    } catch {
      return null; // mape ni
    }
  }

  return {
    async range(ticker) {
      const files = await filesOf(ticker);
      if (!files) return null;
      const [row] = await query(
        'SELECT count(*) AS n, min(open_time) AS first, max(open_time) AS last FROM read_parquet(?)',
        [files],
      );
      return {
        from: new Date(Number(row.first)).toISOString(),
        to: new Date(Number(row.last)).toISOString(),
        candles: Number(row.n),
      };
    },

    async count(ticker, fromMs, toMs, intervalMs = BASE_INTERVAL_MS) {
      const files = await filesOf(ticker);
      if (!files) return 0;
      const sql =
        intervalMs === BASE_INTERVAL_MS
          ? 'SELECT count(*) AS n FROM read_parquet(?) WHERE open_time >= ? AND open_time < ?'
          : `SELECT count(DISTINCT open_time // ${intervalMs}) AS n FROM read_parquet(?) WHERE open_time >= ? AND open_time < ?`;
      const [row] = await query(sql, [files, fromMs, toMs]);
      return Number(row.n);
    },

    // Svečke z open_time v [fromMs, toMs), urejene po času.
    async candles(ticker, fromMs, toMs, intervalMs = BASE_INTERVAL_MS) {
      const files = await filesOf(ticker);
      if (!files) return [];
      // Dolžina svečke je celo število iz našega seznama (ne iz zahtevka), zato jo smemo vstaviti v SQL.
      const sql =
        intervalMs === BASE_INTERVAL_MS
          ? `SELECT open_time, open, high, low, close, volume FROM read_parquet(?)
             WHERE open_time >= ? AND open_time < ? ORDER BY open_time`
          : `SELECT (open_time // ${intervalMs}) * ${intervalMs} AS open_time, arg_min(open, open_time) AS open, max(high) AS high,
                    min(low) AS low, arg_max(close, open_time) AS close, sum(volume) AS volume
             FROM read_parquet(?) WHERE open_time >= ? AND open_time < ? GROUP BY 1 ORDER BY 1`;
      const rows = await query(sql, [files, fromMs, toMs]);
      return rows.map((r) => ({
        time: Number(r.open_time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
    },
  };
}
