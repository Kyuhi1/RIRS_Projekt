import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const SOURCE = 'export default (bars, params) => []';
const send = (base: string, method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const upload = async (base: string, cookie: string, extra: Record<string, unknown> = {}) =>
  ((await (await send(base, 'POST', '/api/strategies', cookie, { name: 'Moja strategija', description: 'opis', source: SOURCE, default_params: '{"n": 1}', ...extra })).json()) as any).id as number;
const addTest = (pool: Pool, strategyId: number, email: string) =>
  pool.query(
    `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results)
     SELECT id, $1, 'gross', '2024-01-01', '2024-01-03', '{}' FROM users WHERE email = $2`,
    [strategyId, email],
  );

async function setup(base: string, pool: Pool) {
  const ana = await loginCookie(base, await addUser(pool, 'trader', 'ana@example.com'));
  const bor = await loginCookie(base, await addUser(pool, 'trader', 'bor@example.com'));
  return { ana, bor };
}

test('PATCH spremeni samo podana polja lastne strategije; vidnost in lastnik ostaneta', async () => {
  await withApp(async (base, pool) => {
    const { ana } = await setup(base, pool);
    const id = await upload(base, ana);

    const renamed = await send(base, 'PATCH', `/api/strategies/${id}`, ana, { name: '  Novo ime ', visibility: 'shared', owner_id: 1 });
    assert.equal(renamed.status, 200);
    let body = (await renamed.json()) as any;
    assert.deepEqual([body.name, body.description, body.source, body.default_params, body.visibility, body.mine], ['Novo ime', 'opis', SOURCE, { n: 1 }, 'private', true]);

    const all = await send(base, 'PATCH', `/api/strategies/${id}`, ana, {
      name: 'Tretje ime',
      description: '',
      source: 'export default () => [] // v2',
      default_params: '{"fast": 3, "on": true}',
    });
    body = (await all.json()) as any;
    assert.deepEqual([body.name, body.description, body.source, body.default_params], ['Tretje ime', '', 'export default () => [] // v2', { fast: 3, on: true }]);

    const cleared = (await (await send(base, 'PATCH', `/api/strategies/${id}`, ana, { default_params: '' })).json()) as any;
    assert.deepEqual(cleared.default_params, {});
  });
});

test('PATCH z neveljavnimi polji vrne napake ob poljih in ničesar ne spremeni', async () => {
  await withApp(async (base, pool) => {
    const { ana } = await setup(base, pool);
    const id = await upload(base, ana);
    const res = await send(base, 'PATCH', `/api/strategies/${id}`, ana, { name: 'ab', source: 'const x = 1;', default_params: '{', description: 'dober opis' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(((await res.json()) as any).errors).sort(), ['default_params', 'name', 'source']);
    const row = (await pool.query('SELECT name, description, source FROM strategies WHERE id = $1', [id])).rows[0];
    assert.deepEqual([row.name, row.description, row.source], ['Moja strategija', 'opis', SOURCE]);

    for (const body of [{}, { visibility: 'shared' }, [], 'nekaj']) {
      const empty = await send(base, 'PATCH', `/api/strategies/${id}`, ana, body);
      assert.equal(empty.status, 400, JSON.stringify(body));
      assert.equal(((await empty.json()) as any).error, 'Ni polj za spremembo');
    }
  });
});

test('tuje strategije ni mogoče urejati ali brisati: zasebna 404, sistemska in deljena 403', async () => {
  await withApp(async (base, pool) => {
    const { ana, bor } = await setup(base, pool);
    const zasebna = await upload(base, ana);
    const deljena = await upload(base, ana, { name: 'Deljena' });
    await pool.query("UPDATE strategies SET visibility = 'shared' WHERE id = $1", [deljena]);
    const sistemska = Number((await pool.query('SELECT id FROM strategies WHERE owner_id IS NULL ORDER BY id LIMIT 1')).rows[0].id);

    for (const method of ['PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { name: 'Hekano ime' } : undefined;
      assert.equal((await send(base, method, `/api/strategies/${zasebna}`, bor, body)).status, 404, `${method} zasebna`);
      assert.equal((await send(base, method, `/api/strategies/${deljena}`, bor, body)).status, 403, `${method} deljena`);
      assert.equal((await send(base, method, `/api/strategies/${sistemska}`, bor, body)).status, 403, `${method} sistemska`);
      assert.equal((await send(base, method, `/api/strategies/${sistemska}`, ana, body)).status, 403, `${method} sistemska (lastnik uporabnik)`);
      assert.equal((await send(base, method, '/api/strategies/99999', ana, body)).status, 404, `${method} neobstoječa`);
      assert.equal((await send(base, method, '/api/strategies/abc', ana, body)).status, 404, `${method} neveljaven id`);
    }
    const names = (await pool.query('SELECT name FROM strategies WHERE id = ANY($1) ORDER BY id', [[zasebna, deljena]])).rows.map((r) => r.name);
    assert.deepEqual(names, ['Moja strategija', 'Deljena']); // nič ni bilo spremenjeno ali izbrisano
  });
});

test('DELETE izbriše lastno strategijo brez testov', async () => {
  await withApp(async (base, pool) => {
    const { ana } = await setup(base, pool);
    const id = await upload(base, ana);
    const res = await send(base, 'DELETE', `/api/strategies/${id}`, ana);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id });
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, ana)).status, 404);
  });
});

test('strategije z izvedenimi testi ni mogoče izbrisati, odgovor vsebuje število testov', async () => {
  await withApp(async (base, pool) => {
    const { ana } = await setup(base, pool);
    const id = await upload(base, ana);
    await addTest(pool, id, 'ana@example.com');
    let res = await send(base, 'DELETE', `/api/strategies/${id}`, ana);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'Strategije ni mogoče izbrisati, ker jo uporablja 1 test', tests: 1 });

    await addTest(pool, id, 'ana@example.com');
    res = await send(base, 'DELETE', `/api/strategies/${id}`, ana);
    assert.equal(((await res.json()) as any).tests, 2);
    assert.equal((await send(base, 'GET', `/api/strategies/${id}`, ana)).status, 200); // strategija je ostala

    // urejanje strategije z testi je dovoljeno
    assert.equal((await send(base, 'PATCH', `/api/strategies/${id}`, ana, { description: 'posodobljen opis' })).status, 200);

    await pool.query('DELETE FROM backtests WHERE strategy_id = $1', [id]);
    assert.equal((await send(base, 'DELETE', `/api/strategies/${id}`, ana)).status, 200); // po brisanju testov gre
  });
});

test('urejanje in brisanje zahtevata prijavo vloge trgovec', async () => {
  await withApp(async (base, pool) => {
    const { ana } = await setup(base, pool);
    const id = await upload(base, ana);
    const cookies = {
      mentor: await loginCookie(base, await addUser(pool, 'mentor')),
      admin: await loginCookie(base, await addUser(pool, 'admin')),
    };
    for (const method of ['PATCH', 'DELETE']) {
      assert.equal((await send(base, method, `/api/strategies/${id}`, undefined, { name: 'Ime' })).status, 401, method);
      for (const [role, cookie] of Object.entries(cookies)) {
        assert.equal((await send(base, method, `/api/strategies/${id}`, cookie, { name: 'Ime' })).status, 403, `${method} ${role}`);
      }
    }
  });
});
