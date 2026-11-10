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

export interface DataRange {
  from: string; // ISO čas prve svečke
  to: string; // ISO čas zadnje svečke
  candles: number;
}

export interface CandleStore {
  range(ticker: string): Promise<DataRange | null>;
  candles(ticker: string, fromMs: number, toMs: number): Promise<Candle[]>;
  count(ticker: string, fromMs: number, toMs: number): Promise<number>; // število svečk v [fromMs, toMs), brez nalaganja
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

    async count(ticker, fromMs, toMs) {
      const files = await filesOf(ticker);
      if (!files) return 0;
      const [row] = await query('SELECT count(*) AS n FROM read_parquet(?) WHERE open_time >= ? AND open_time < ?', [files, fromMs, toMs]);
      return Number(row.n);
    },

    // Svečke z open_time v [fromMs, toMs), urejene po času.
    async candles(ticker, fromMs, toMs) {
      const files = await filesOf(ticker);
      if (!files) return [];
      const rows = await query(
        `SELECT open_time, open, high, low, close, volume FROM read_parquet(?)
         WHERE open_time >= ? AND open_time < ? ORDER BY open_time`,
        [files, fromMs, toMs],
      );
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
