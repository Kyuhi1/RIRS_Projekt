import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDefaultParams, checkDescription, checkName, checkSource, MAX_SOURCE_BYTES, validateNewStrategy } from './strategyUpload.ts';

const VALID = 'export default (bars, params) => []';
const errorOf = (r: { ok: boolean; errors?: Record<string, string> }, field: string) => (r.ok ? undefined : r.errors![field]);

test('ime: obvezno, 3 do 80 znakov po odstranitvi presledkov', () => {
  assert.equal(errorOf(checkName(undefined), 'name'), 'Ime je obvezno');
  assert.equal(errorOf(checkName(42), 'name'), 'Ime je obvezno');
  assert.match(errorOf(checkName('ab'), 'name')!, /od 3 do 80/);
  assert.match(errorOf(checkName('  ab  '), 'name')!, /od 3 do 80/);
  assert.match(errorOf(checkName('a'.repeat(81)), 'name')!, /od 3 do 80/);
  assert.deepEqual(checkName('  abc '), { ok: true, value: 'abc' });
  assert.deepEqual(checkName('a'.repeat(80)), { ok: true, value: 'a'.repeat(80) });
});

test('opis: neobvezen, največ 500 znakov', () => {
  assert.deepEqual(checkDescription(undefined), { ok: true, value: '' });
  assert.deepEqual(checkDescription(null), { ok: true, value: '' });
  assert.deepEqual(checkDescription(' kratek '), { ok: true, value: 'kratek' });
  assert.ok(errorOf(checkDescription('a'.repeat(501)), 'description'));
  assert.ok(errorOf(checkDescription(5), 'description'));
});

test('datoteka: obvezna, do 100 KB, besedilo z »export default« in razčlenljiva', () => {
  assert.equal(errorOf(checkSource(undefined), 'source'), 'Datoteka strategije je obvezna');
  assert.equal(errorOf(checkSource('   \n'), 'source'), 'Datoteka strategije je obvezna');
  assert.deepEqual(checkSource(VALID), { ok: true, value: VALID });

  // meja 100 KB je v bajtih: točno 100 KB je še v redu, en bajt več ne
  const pad = (bytes: number) => `${VALID}\n//${'a'.repeat(bytes - Buffer.byteLength(VALID) - 3)}`;
  assert.equal(checkSource(pad(MAX_SOURCE_BYTES)).ok, true);
  assert.match(errorOf(checkSource(pad(MAX_SOURCE_BYTES + 1)), 'source')!, /prevelika \(100 KB\), dovoljenih je največ 100 KB/);
  assert.match(errorOf(checkSource(`${VALID}\n//${'č'.repeat(60_000)}`), 'source')!, /prevelika/); // večbajtni znaki štejejo kot bajti

  assert.match(errorOf(checkSource(`${VALID}\u0000\u0001`), 'source')!, /binarna/);
  assert.match(errorOf(checkSource('const strategy = () => [];'), 'source')!, /ni v podprtem formatu.*export default/);
});

test('datoteka, ki je ni mogoče razčleniti, vrne razlog in vrstico', () => {
  const result = checkSource('const a = 1;\nconst b = ;\nexport default () => [];');
  assert.match(errorOf(result, 'source')!, /^Datoteke ni mogoče razčleniti \(vrstica 2\): /);
  assert.match(errorOf(checkSource('export default () => {'), 'source')!, /vrstica 1\b/);
  assert.match(errorOf(checkSource("import x from 'y';\nexport default () => [];"), 'source')!, /ni mogoče razčleniti/);
  assert.match(errorOf(checkSource('export default () => [];\nexport const x = 1;'), 'source')!, /ni mogoče razčleniti/);
});

test('razčlenitev kode ne zažene', () => {
  const marker = `__pognano_${Date.now()}`;
  assert.equal(checkSource(`globalThis.${marker} = true; export default () => [];`).ok, true);
  assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
});

test('privzeti parametri: prazno ali JSON objekt s številom, besedilom in booleanom', () => {
  for (const empty of [undefined, null, '', '  ']) assert.deepEqual(checkDefaultParams(empty), { ok: true, value: {} });
  assert.deepEqual(checkDefaultParams('{"fast": 10, "mode": "ema", "long": true}'), { ok: true, value: { fast: 10, mode: 'ema', long: true } });
  assert.deepEqual(checkDefaultParams({ fast: 10 }), { ok: true, value: { fast: 10 } });
  assert.deepEqual(checkDefaultParams('{}'), { ok: true, value: {} });
});

test('neveljavni privzeti parametri dajo napako ob polju default_params', () => {
  assert.equal(errorOf(checkDefaultParams('{fast: 10}'), 'default_params'), 'Privzeti parametri niso veljaven JSON');
  assert.equal(errorOf(checkDefaultParams('{"fast": 10'), 'default_params'), 'Privzeti parametri niso veljaven JSON');
  for (const value of ['[1, 2]', '5', '"besedilo"', 'null', 7, [1]]) {
    // »null« kot besedilo je veljaven JSON, a ni objekt; nepodane vrednosti so prazne (zgoraj)
    const result = checkDefaultParams(value);
    assert.match(errorOf(result, 'default_params')!, /morajo biti JSON objekt/, String(value));
  }
  assert.match(errorOf(checkDefaultParams('{"a": {"b": 1}}'), 'default_params')!, /»a« mora biti število, besedilo ali true\/false/);
  assert.match(errorOf(checkDefaultParams('{"a": null}'), 'default_params')!, /»a«/);
  assert.match(errorOf(checkDefaultParams('{"a": [1]}'), 'default_params')!, /»a«/);
  assert.match(errorOf(checkDefaultParams(JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, i])))), 'default_params')!, /največ 20/);
  assert.match(errorOf(checkDefaultParams({ [`${'x'.repeat(41)}`]: 1 }), 'default_params')!, /od 1 do 40/);
  assert.match(errorOf(checkDefaultParams({ a: 'x'.repeat(201) }), 'default_params')!, /predolgo/);
});

test('validateNewStrategy zbere napake vseh polj hkrati', () => {
  const result = validateNewStrategy({ name: 'a', source: 'x', default_params: '{' });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys((result as { errors: object }).errors).sort(), ['default_params', 'name', 'source']);
  assert.deepEqual(validateNewStrategy({ name: ' Moja ', source: VALID, default_params: '{"n": 1}' }), {
    ok: true,
    value: { name: 'Moja', description: '', source: VALID, defaultParams: { n: 1 } },
  });
  assert.equal(validateNewStrategy('nekaj').ok, false);
  assert.equal(validateNewStrategy(null).ok, false);
});
