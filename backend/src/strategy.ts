import { Worker } from 'node:worker_threads';
import type { Candle } from './candles.ts';
import type { Trade } from './simulation.ts';

// Napaka, katere sporočilo je namenjeno uporabniku (brez notranjih podrobnosti strežnika).
export class StrategyError extends Error {}

export interface RunOptions {
  timeoutMs?: number; // največji čas izvajanja, privzeto 5 min
  memoryMb?: number; // največ pomnilnika delavca, privzeto 1024 MB (dovolj za nekaj sto tisoč svečk)
}

const WORKER = new URL('./strategyWorker.ts', import.meta.url);
const MAX_MESSAGE = 300;
const KILL_GRACE_MS = 1_000; // rezerva, preden delavca ustavimo od zunaj

// Zažene strategijo `export default (bars, params) => trades[]` v ločenem delavcu in vrne njene posle.
// Delavec dobi samo svečke in parametre; backendu vrne samo rezultat.
export function runStrategy(source: string, bars: Candle[], params: unknown, options: RunOptions = {}): Promise<Trade[]> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const memoryMb = options.memoryMb ?? 1024;
  const timeoutMessage = `Strategija je presegla časovno omejitev (${Math.round(timeoutMs / 100) / 10} s)`;
  const input = JSON.stringify([bars, params ?? {}]);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { source, input, timeoutMs },
      env: {}, // delavec ne vidi spremenljivk okolja (DATABASE_URL, JWT_SECRET ...)
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 16 },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      void worker.terminate(); // konča samo tega delavca, backend teče naprej
      fn();
    };
    // Zadnja varovalka, če delavec ne odgovori (vm časovna omejitev je znotraj delavca).
    const killTimer = setTimeout(() => finish(() => reject(new StrategyError(timeoutMessage))), timeoutMs + KILL_GRACE_MS);

    worker.once('message', (message: { trades?: Trade[]; error?: string }) =>
      finish(() => {
        if (message.error === 'TIMEOUT') reject(new StrategyError(timeoutMessage));
        else if (message.error !== undefined) reject(new StrategyError(`Strategija je vrnila napako: ${message.error.slice(0, MAX_MESSAGE)}`));
        else resolve(message.trades ?? []);
      }),
    );
    worker.once('error', (err) =>
      finish(() => {
        if ((err as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY') {
          reject(new StrategyError(`Strategija je presegla pomnilniško omejitev (${memoryMb} MB)`));
        } else {
          console.error(err); // podrobnosti samo v dnevnik strežnika
          reject(new StrategyError('Strategije ni bilo mogoče izvesti'));
        }
      }),
    );
    worker.once('exit', () => finish(() => reject(new StrategyError('Strategije ni bilo mogoče izvesti'))));
  });
}
