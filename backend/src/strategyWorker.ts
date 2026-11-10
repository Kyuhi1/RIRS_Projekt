// Koda v tem delavcu teče v worker_thread. Uporabniška strategija se izvede v praznem vm kontekstu brez
// process, require, fetch, console in časovnikov; podatki gredo noter in ven samo kot nizi JSON,
// da strategija ne dobi referenc na objekte iz tega sveta. Delavec ne uvaža nobenega modula backenda (baza, datoteke).
import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

interface Input {
  source: string;
  input: string; // JSON: [bars, params]
  timeoutMs: number;
}

type Message = { trades: unknown[] } | { error: string };

function run({ source, input, timeoutMs }: Input): Message {
  if (!/\bexport\s+default\b/.test(source)) return { error: 'Strategija mora vsebovati »export default«' };

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }, // brez eval in new Function
    microtaskMode: 'afterEvaluate', // obljube se izvedejo znotraj časovne omejitve
  });
  context.__input = input;

  // Napake in rezultat obdelamo znotraj konteksta, da z ven vržen objekt ne požene kode zunaj omejitve.
  const script = `var __result;
try {
  var __strategy;
  ${source.replace(/\bexport\s+default\b/, '__strategy =')}
  ;var __in = JSON.parse(__input);
  var __trades = __strategy(__in[0], __in[1]);
  if (!Array.isArray(__trades)) throw new Error('Strategija mora vrniti seznam poslov');
  __result = JSON.stringify({ trades: __trades });
} catch (e) {
  __result = JSON.stringify({ error: String(e && e.message !== undefined ? e.message : e) });
}
__result;`;

  try {
    const out: unknown = vm.runInContext(script, context, { timeout: timeoutMs, filename: 'strategija.js' });
    if (typeof out !== 'string') return { error: 'Strategija je vrnila neveljaven rezultat' };
    return JSON.parse(out) as Message;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { error: 'TIMEOUT' };
    const message = err instanceof Error ? err.message : 'neznana napaka';
    return { error: `Napaka v kodi strategije: ${message}` };
  }
}

parentPort!.postMessage(run(workerData as Input));
