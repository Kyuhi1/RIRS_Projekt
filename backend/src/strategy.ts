import { Worker } from 'node:worker_threads';
import type { Candle } from './candles.ts';
import type { Trade } from './simulation.ts';

// Napaka, katere sporočilo je namenjeno uporabniku (brez notranjih podrobnosti strežnika).
export class StrategyError extends Error {}

export interface RunOptions {
  timeoutMs?: number;
}

const WORKER = new URL('./strategyWorker.ts', import.meta.url);
const MAX_MESSAGE = 300;

// Zažene strategijo `export default (bars, params) => trades[]` v ločenem delavcu in vrne njene posle.
// Delavec dobi samo svečke in parametre; backendu vrne samo rezultat.
export function runStrategy(source: string, bars: Candle[], params: unknown, options: RunOptions = {}): Promise<Trade[]> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const input = JSON.stringify([bars, params ?? {}]);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { source, input, timeoutMs },
      env: {}, // delavec ne vidi spremenljivk okolja (DATABASE_URL, JWT_SECRET ...)
    });

    worker.once('message', (message: { trades?: Trade[]; error?: string }) => {
      if (message.error !== undefined) reject(new StrategyError(`Strategija je vrnila napako: ${message.error.slice(0, MAX_MESSAGE)}`));
      else resolve(message.trades ?? []);
    });
    worker.once('error', (err) => {
      console.error(err); // podrobnosti samo v dnevnik strežnika
      reject(new StrategyError('Strategije ni bilo mogoče izvesti'));
    });
    worker.once('exit', () => reject(new StrategyError('Strategije ni bilo mogoče izvesti')));
  });
}
