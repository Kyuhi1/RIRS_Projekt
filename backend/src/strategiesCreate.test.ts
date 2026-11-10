import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const SOURCE = 'export default (bars, params) => []';
const post = (base: string, body: unknown, cookie?: string) =>
  fetch(`${base}/api/strategies`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (base: string, path: string, cookie: string) => fetch(base + path, { headers: { Cookie: cookie } });
const count = async (pool: Pool) => (await pool.query('SELECT count(*)::int AS n FROM strategies')).rows[0].n as number;

test('POST /api/strategies shrani zasebno strategijo prijavljenega trgovca s privzetimi parametri', async () => {
  await withApp(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader', 'ana@example.com'));
    const res = await post(base, { name: '  Moja strategija ', description: 'opis', source: SOURCE, default_params: '{"fast": 5, "mode": "ema"}' }, cookie);
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.deepEqual([body.name, body.description, body.visibility, body.mine, body.system, body.source], ['Moja strategija', 'opis', 'private', true, false, SOURCE]);
    assert.deepEqual(body.default_params, { fast: 5, mode: 'ema' });

    const row = (await pool.query('SELECT owner_id, visibility FROM strategies WHERE id = $1', [body.id])).rows[0];
    const ana = (await pool.query("SELECT id FROM users WHERE email = 'ana@example.com'")).rows[0].id;
    assert.deepEqual([row.owner_id, row.visibility], [ana, 'private']);

    const list = (await (await get(base, '/api/strategies', cookie)).json()) as any[];
    assert.ok(list.some((s) => s.id === body.id && s.mine)); // na voljo v izbirniku novega testa
  });
});

test('neobvezna polja so lahko izpuščena, privzeti parametri objekt ali besedilo', async () => {
  await withApp(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader'));
    const minimal = (await (await post(base, { name: 'Minimalna', source: SOURCE }, cookie)).json()) as any;
    assert.deepEqual([minimal.description, minimal.default_params], ['', {}]);
    const object = await post(base, { name: 'Z objektom', source: SOURCE, default_params: { period: 20 } }, cookie);
    assert.equal(object.status, 201);
    assert.deepEqual(((await object.json()) as any).default_params, { period: 20 });
  });
});

test('neveljavni vnosi so zavrnjeni z napako ob polju in se ne shranijo', async () => {
  await withApp(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader'));
    const before = await count(pool);
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{ source: SOURCE }, 'name', /obvezno/],
      [{ name: 'ab', source: SOURCE }, 'name', /od 3 do 80/],
      [{ name: 'a'.repeat(81), source: SOURCE }, 'name', /od 3 do 80/],
      [{ name: 'Ime' }, 'source', /obvezna/],
      [{ name: 'Ime', source: 'const x = 1;' }, 'source', /podprtem formatu/],
      [{ name: 'Ime', source: 'export default () => {' }, 'source', /ni mogoče razčleniti/],
      [{ name: 'Ime', source: `${SOURCE}\n//${'a'.repeat(101 * 1024)}` }, 'source', /prevelika/],
      [{ name: 'Ime', source: SOURCE, default_params: '{nepravilno' }, 'default_params', /niso veljaven JSON/],
      [{ name: 'Ime', source: SOURCE, default_params: '[1]' }, 'default_params', /JSON objekt/],
      [{ name: 'Ime', source: SOURCE, description: 'a'.repeat(501) }, 'description', /največ 500/],
    ];
    for (const [body, field, message] of cases) {
      const res = await post(base, body, cookie);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      const { errors } = (await res.json()) as { errors: Record<string, string> };
      assert.match(errors[field]!, message, field);
    }
    // več napak hkrati
    const many = (await (await post(base, { name: 'a', source: 'x', default_params: '{' }, cookie)).json()) as any;
    assert.deepEqual(Object.keys(many.errors).sort(), ['default_params', 'name', 'source']);
    assert.equal(await count(pool), before);
  });
});

test('zelo velika datoteka ali telo, ki ni JSON, je zavrnjeno brez zrušitve', async () => {
  await withApp(async (base, pool) => {
    const cookie = await loginCookie(base, await addUser(pool, 'trader'));
    const huge = await post(base, { name: 'Velika', source: `${SOURCE}\n//${'a'.repeat(700_000)}` }, cookie);
    assert.equal(huge.status, 400);
    assert.match(((await huge.json()) as any).errors.source, /prevelika/);
    const broken = await fetch(`${base}/api/strategies`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{' });
    assert.equal(broken.status, 400);
    assert.equal((await get(base, '/api/auth/me', cookie)).status, 200); // strežnik teče naprej
  });
});

test('nalaganje strategij zahteva prijavo vloge trgovec', async () => {
  await withApp(async (base, pool) => {
    assert.equal((await post(base, { name: 'Ime', source: SOURCE })).status, 401);
    for (const role of ['mentor', 'admin']) {
      const cookie = await loginCookie(base, await addUser(pool, role));
      assert.equal((await post(base, { name: 'Ime', source: SOURCE }, cookie)).status, 403, role);
    }
  });
});

test('naložena strategija je zasebna: drug trgovec je ne vidi', async () => {
  await withApp(async (base, pool) => {
    const ana = await loginCookie(base, await addUser(pool, 'trader', 'ana@example.com'));
    const bor = await loginCookie(base, await addUser(pool, 'trader', 'bor@example.com'));
    const id = ((await (await post(base, { name: 'Anina', source: SOURCE }, ana)).json()) as any).id as number;
    assert.equal((await get(base, `/api/strategies/${id}`, bor)).status, 404);
    assert.ok(!((await (await get(base, '/api/strategies', bor)).json()) as any[]).some((s) => s.id === id));
  });
});
