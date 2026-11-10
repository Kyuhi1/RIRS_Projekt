import vm from 'node:vm';

export const MAX_SOURCE_BYTES = 100 * 1024;
export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;
const MAX_PARAMS = 20;
const MAX_PARAM_NAME = 40;
const MAX_PARAM_STRING = 200;

export type FieldErrors = Record<string, string>;
export type Params = Record<string, string | number | boolean>;
type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface StrategyInput {
  name: string;
  description: string;
  source: string;
  defaultParams: Params;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const good = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (field: string, message: string): Checked<never> => ({ ok: false, errors: { [field]: message } });

export function checkName(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('name', 'Ime je obvezno');
  const name = value.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return bad('name', `Ime mora imeti od ${NAME_MIN} do ${NAME_MAX} znakov`);
  return good(name);
}

export function checkDescription(value: unknown): Checked<string> {
  if (value === undefined || value === null) return good('');
  if (typeof value !== 'string') return bad('description', 'Opis mora biti besedilo');
  const description = value.trim();
  return description.length > DESCRIPTION_MAX ? bad('description', `Opis je lahko dolg največ ${DESCRIPTION_MAX} znakov`) : good(description);
}

// Datoteko preverimo brez izvajanja: velikost, oblika (JavaScript z »export default«) in razčlenitev.
// Koda se prevede z enakim ovojem kot v delavcu (strategyWorker.ts), vendar se nikoli ne zažene.
export function checkSource(value: unknown): Checked<string> {
  if (typeof value !== 'string' || value.trim() === '') return bad('source', 'Datoteka strategije je obvezna');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) {
    return bad('source', `Datoteka je prevelika (${Math.round(bytes / 1024)} KB), dovoljenih je največ ${MAX_SOURCE_BYTES / 1024} KB`);
  }
  if (value.includes('\u0000')) return bad('source', 'Datoteka ni v podprtem formatu: pričakovano je besedilo JavaScript, ne binarna datoteka');
  if (!/\bexport\s+default\b/.test(value)) {
    return bad('source', 'Datoteka ni v podprtem formatu: strategija mora vsebovati »export default (bars, params) => trades«');
  }
  const wrapped = `try {\n  var __strategy;\n  ${value.replace(/\bexport\s+default\b/, '__strategy =')}\n} catch (e) {}`;
  try {
    new vm.Script(wrapped, { filename: 'strategija.js', lineOffset: -2 });
  } catch (err) {
    // Pri nezaprtem bloku V8 javi vrstico ovoja za datoteko, zato vrstico omejimo na dolžino datoteke.
    const reported = /strategija\.js:(\d+)/.exec(String((err as Error).stack))?.[1];
    const line = reported ? Math.min(Number(reported), value.split('\n').length) : undefined;
    const reason = err instanceof Error ? err.message.slice(0, 200) : 'neznana napaka';
    return bad('source', `Datoteke ni mogoče razčleniti${line ? ` (vrstica ${line})` : ''}: ${reason}`);
  }
  return good(value);
}

// Privzeti parametri so JSON objekt z vrednostmi število, besedilo ali boolean (to podpira obrazec novega testa).
// Sprejmemo besedilo JSON (polje obrazca) ali že razčlenjen objekt; prazno pomeni brez parametrov.
export function checkDefaultParams(value: unknown): Checked<Params> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return good({});
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return bad('default_params', 'Privzeti parametri niso veljaven JSON');
    }
  }
  if (!isObject(parsed)) return bad('default_params', 'Privzeti parametri morajo biti JSON objekt, npr. {"fast": 10}');
  const entries = Object.entries(parsed);
  if (entries.length > MAX_PARAMS) return bad('default_params', `Parametrov je lahko največ ${MAX_PARAMS}`);
  for (const [key, v] of entries) {
    if (key.length === 0 || key.length > MAX_PARAM_NAME) return bad('default_params', `Ime parametra mora imeti od 1 do ${MAX_PARAM_NAME} znakov`);
    const scalar = typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
    if (!scalar) return bad('default_params', `Parameter »${key}« mora biti število, besedilo ali true/false`);
    if (typeof v === 'string' && v.length > MAX_PARAM_STRING) return bad('default_params', `Besedilo parametra »${key}« je predolgo`);
  }
  return good(parsed as Params);
}

// Preveri vsa polja nove strategije in zbere napake ob poljih.
export function validateNewStrategy(input: unknown): Checked<StrategyInput> {
  const body = isObject(input) ? input : {};
  const name = checkName(body.name);
  const description = checkDescription(body.description);
  const source = checkSource(body.source);
  const defaultParams = checkDefaultParams(body.default_params);
  if (name.ok && description.ok && source.ok && defaultParams.ok) {
    return good({ name: name.value, description: description.value, source: source.value, defaultParams: defaultParams.value });
  }
  const errors: FieldErrors = {};
  for (const part of [name, description, source, defaultParams]) if (!part.ok) Object.assign(errors, part.errors);
  return { ok: false, errors };
}
