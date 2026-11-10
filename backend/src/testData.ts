import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

// Ustvari <dataDir>/<ticker>/<file> s `count` minutnimi svečkami od startMs.
// Vrednosti so predvidljive (open = 100 + i), da jih lahko test preveri.
export async function writeTestParquet(
  dataDir: string,
  ticker: string,
  file: string,
  startMs: number,
  count: number,
): Promise<void> {
  const dir = join(dataDir, ticker);
  await mkdir(dir, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    await connection.run(`
      COPY (
        SELECT (${startMs} + i * 60000)::BIGINT AS open_time,
               100.0 + i AS open, 101.0 + i AS high, 99.0 + i AS low, 100.5 + i AS close, 1.0 AS volume
        FROM range(${count}) t(i)
      ) TO '${join(dir, file)}' (FORMAT parquet)`);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
