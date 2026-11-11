import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { addUser, loginCookie, withApp } from './testApp.ts';

const send = (base: string, method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as any;

// Mentor m1 (aktivna učenca t1 in t2, prekinjena t3), mentor m2 (učenec t4) in administrator.
async function setup(base: string, pool: Pool) {
  const users: Record<string, [string, string]> = {
    m1: ['mentor', 'm1@example.com'], m2: ['mentor', 'm2@example.com'], admin: ['admin', 'admin@example.com'],
    t1: ['trader', 't1@example.com'], t2: ['trader', 't2@example.com'], t3: ['trader', 't3@example.com'], t4: ['trader', 't4@example.com'],
  };
  const id: Record<string, number> = {};
  const cookie: Record<string, string> = {};
  for (const [key, [role, email]] of Object.entries(users)) {
    await addUser(pool, role, email);
    id[key] = Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
    cookie[key] = await loginCookie(base, email);
  }
  const link = (m: string, t: string, status: string) => pool.query('INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, $3)', [id[m], id[t], status]);
  await link('m1', 't1', 'active'); await link('m1', 't2', 'active'); await link('m1', 't3', 'ended'); await link('m2', 't4', 'active');
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  const make = async (owner: string, status: string, reviewer = 'm1') =>
    Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results, status, reviewer_id)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{"trades": []}', $3, $4) RETURNING id`,
      [id[owner], strategy, status, status === 'draft' ? null : id[reviewer]])).rows[0].id);
  const comment = (who: string, test: number, body: unknown, extra: Record<string, unknown> = {}) => send(base, 'POST', `/api/backtests/${test}/comments`, cookie[who], { body, ...extra });
  const count = async (test?: number) => Number((await pool.query(`SELECT count(*) FROM comments ${test ? 'WHERE backtest_id = ' + test : ''}`)).rows[0].count);
  const history = async (test: number) => (await pool.query('SELECT from_status, to_status, changed_by::int AS by FROM status_history WHERE backtest_id = $1 ORDER BY id', [test])).rows;
  return { id, cookie, make, comment, count, history };
}

test('mentor doda komentar med pregledom: obrezano besedilo, privzeto ni napaka, avtor in čas sta zapisana', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make, comment } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    const res = await comment('m1', test, '  Preveri stop loss.  ');
    assert.equal(res.status, 201);
    const created = await json(res);
    assert.deepEqual([created.body, created.is_mistake, created.author], ['Preveri stop loss.', false, { id: id.m1, name: 'Test mentor' }]);
    assert.ok(!Number.isNaN(Date.parse(created.created_at)));
    const second = await json(await comment('m1', test, 'Napaka v izračunu stroškov', { is_mistake: true }));
    assert.equal(second.is_mistake, true);
    const list = await json(await send(base, 'GET', `/api/backtests/${test}/comments`, cookie.m1));
    assert.deepEqual(list.map((c: any) => [c.id, c.body, c.is_mistake]), [[created.id, 'Preveri stop loss.', false], [second.id, 'Napaka v izračunu stroškov', true]]);
  });
});

test('komentar: prazen, samo presledki, predolg ali z napačnimi tipi je zavrnjen (400), 2000 znakov je še v redu', async () => {
  await withApp(async (base, pool) => {
    const { make, comment, count } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    for (const body of ['', '   ', '\n\t', undefined, null, 5, ['a'], 'a'.repeat(2001), '😀'.repeat(2001)]) {
      const res = await comment('m1', test, body);
      assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 20));
      assert.ok((await json(res)).errors.body);
    }
    for (const flag of ['da', 1, null]) {
      const res = await comment('m1', test, 'ok', { is_mistake: flag });
      assert.equal(res.status, 400, String(flag));
      assert.ok((await json(res)).errors.is_mistake);
    }
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/comments`, undefined)).status, 401);
    assert.equal(await count(), 0);
    assert.equal((await comment('m1', test, 'a'.repeat(2000))).status, 201);
    assert.equal((await comment('m1', test, '😀'.repeat(2000))).status, 201); // štejejo znaki, ne bajti
    assert.equal(await count(), 2);
  });
});

test('komentar je mogoč samo v stanju in_review (409), nevidni testi so 404', async () => {
  await withApp(async (base, pool) => {
    const { make, comment, count } = await setup(base, pool);
    for (const status of ['submitted', 'changes_requested', 'approved']) assert.equal((await comment('m1', await make('t1', status), 'x')).status, 409, status);
    const hidden = {
      osnutek: await make('t1', 'draft'),
      umaknjen: await make('t1', 'withdrawn'),
      'tuj učenec': await make('t4', 'in_review', 'm2'),
      'drug mentor': await make('t1', 'in_review', 'm2'),
      'prekinjena povezava': await make('t3', 'in_review'),
    };
    for (const [name, test] of Object.entries(hidden)) assert.equal((await comment('m1', test, 'x')).status, 404, name);
    assert.equal((await comment('m1', 999999, 'x')).status, 404);
    assert.equal((await send(base, 'POST', '/api/backtests/abc/comments', undefined)).status, 401);
    assert.equal(await count(), 0);
  });
});

test('trgovec, administrator in neprijavljen komentarjev ne morejo dodajati, spreminjati ali brisati', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, comment, count } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    const first = await json(await comment('m1', test, 'prvi'));
    assert.equal((await comment('t1', test, 'trgovec')).status, 403);
    assert.equal((await comment('admin', test, 'admin')).status, 403);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal((await send(base, method, `/api/backtests/${test}/comments`, cookie.m1, { body: 'x' })).status, 405, method);
      assert.equal((await send(base, method, `/api/backtests/${test}/comments`, cookie.t1, { body: 'x' })).status, 405, method);
      assert.equal((await send(base, method, `/api/backtests/${test}/comments/${first.id}`, cookie.m1, { body: 'x' })).status, 404, method); // poti za posamezen komentar ni
      assert.equal((await send(base, method, `/api/backtests/${test}/comments/${first.id}`, cookie.t1, { body: 'x' })).status, 404, method);
    }
    assert.deepEqual((await pool.query('SELECT body FROM comments')).rows, [{ body: 'prvi' }]);
    assert.equal(await count(), 1);
  });
});

test('komentarje bereta lastnik testa (tudi po zahtevanih spremembah) in njegov mentor, drugi ne', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, comment } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    await comment('m1', test, 'Predolga pozicija', { is_mistake: true });
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/request-changes`, cookie.m1)).status, 200);
    const seen = await json(await send(base, 'GET', `/api/backtests/${test}/comments`, cookie.t1));
    assert.deepEqual(seen.map((c: any) => [c.body, c.is_mistake, c.author.name]), [['Predolga pozicija', true, 'Test mentor']]);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}/comments`, cookie.m1)).status, 200);
    for (const who of ['t2', 't4', 'm2', 't3']) assert.equal((await send(base, 'GET', `/api/backtests/${test}/comments`, cookie[who])).status, 404, who);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}/comments`, cookie.admin)).status, 403);
    assert.equal((await send(base, 'GET', `/api/backtests/${test}/comments`)).status, 401);
    const draft = await make('t1', 'draft');
    assert.deepEqual(await json(await send(base, 'GET', `/api/backtests/${draft}/comments`, cookie.t1)), []);
    assert.equal((await send(base, 'GET', `/api/backtests/${draft}/comments`, cookie.m1)).status, 404);
    assert.equal((await send(base, 'GET', '/api/backtests/abc/comments', cookie.t1)).status, 404);
  });
});

test('zahteva za spremembe: brez komentarja 409, s komentarjem changes_requested z zapisom v zgodovini', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make, comment, history } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    const none = await send(base, 'POST', `/api/backtests/${test}/request-changes`, cookie.m1);
    assert.equal(none.status, 409);
    assert.match((await json(none)).error, /vsaj en komentar/);
    assert.deepEqual([(await pool.query('SELECT status FROM backtests WHERE id = $1', [test])).rows[0].status, await history(test)], ['in_review', []]);
    await comment('m1', test, 'Popravi parametre');
    const res = await send(base, 'POST', `/api/backtests/${test}/request-changes`, cookie.m1);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, 'changes_requested');
    assert.deepEqual(body.history.map((h: any) => [h.from_status, h.to_status, h.changed_by.id]), [['in_review', 'changes_requested', id.m1]]);
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/request-changes`, cookie.m1)).status, 409); // ne podvoji zgodovine
    assert.equal((await comment('m1', test, 'še eno')).status, 409);
    assert.equal((await history(test)).length, 1);
  });
});

test('odobritev: in_review postane approved z zapisom v zgodovini, potem komentarjev ni več mogoče dodajati', async () => {
  await withApp(async (base, pool) => {
    const { id, cookie, make, comment, count, history } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    const res = await send(base, 'POST', `/api/backtests/${test}/approve`, cookie.m1); // brez komentarja je odobritev dovoljena
    assert.equal(res.status, 200);
    assert.equal((await json(res)).status, 'approved');
    assert.deepEqual(await history(test), [{ from_status: 'in_review', to_status: 'approved', by: id.m1 }]);
    assert.equal((await comment('m1', test, 'prepozno')).status, 409);
    assert.equal(await count(test), 0);
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/approve`, cookie.m1)).status, 409);
    assert.equal((await send(base, 'POST', `/api/backtests/${test}/request-changes`, cookie.m1)).status, 409);
    assert.equal((await history(test)).length, 1);
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${test}`, cookie.t1))).status, 'approved');
  });
});

test('odločitev je mogoča samo med pregledom, samo za vidne teste in samo za mentorje', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, comment } = await setup(base, pool);
    for (const action of ['approve', 'request-changes']) {
      for (const status of ['submitted', 'changes_requested', 'approved']) assert.equal((await send(base, 'POST', `/api/backtests/${await make('t1', status)}/${action}`, cookie.m1)).status, 409, `${action} ${status}`);
      for (const hidden of [await make('t1', 'draft'), await make('t1', 'withdrawn'), await make('t4', 'in_review', 'm2'), await make('t3', 'in_review')]) {
        assert.equal((await send(base, 'POST', `/api/backtests/${hidden}/${action}`, cookie.m1)).status, 404, `${action} ${hidden}`);
      }
      const mine = await make('t1', 'in_review');
      await comment('m1', mine, 'x');
      assert.equal((await send(base, 'POST', `/api/backtests/${mine}/${action}`, cookie.t1)).status, 403);
      assert.equal((await send(base, 'POST', `/api/backtests/${mine}/${action}`, cookie.admin)).status, 403);
      assert.equal((await send(base, 'POST', `/api/backtests/${mine}/${action}`)).status, 401);
      assert.equal((await send(base, 'POST', `/api/backtests/${mine}/${action}`, cookie.m2)).status, 404);
      assert.equal((await send(base, 'GET', `/api/backtests/${mine}/${action}`, cookie.m1)).status, 405);
      assert.equal((await send(base, 'POST', `/api/backtests/999999/${action}`, cookie.m1)).status, 404);
      assert.equal((await send(base, 'POST', `/api/backtests/abc/${action}`, cookie.m1)).status, 404);
    }
  });
});

test('komentar in sočasna odobritev: vsak uspešen komentar je shranjen, zavrnjeni (409) niso, po odobritvi ni novih', async () => {
  await withApp(async (base, pool) => {
    const { cookie, make, comment, count } = await setup(base, pool);
    const test = await make('t1', 'in_review');
    const results = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => comment('m1', test, `komentar ${i}`)),
      send(base, 'POST', `/api/backtests/${test}/approve`, cookie.m1),
    ]);
    assert.equal(results[5]!.status, 200);
    const attempts = results.slice(0, 5);
    assert.ok(attempts.every((r) => r.status === 201 || r.status === 409));
    // Zaklenjena vrstica testa: komentar je ali shranjen pred odobritvijo (201) ali zavrnjen po njej (409).
    // Časov ne primerjamo, ker now() v transakciji pomeni njen začetek, ne commita.
    const stored = await count(test);
    assert.equal(attempts.filter((r) => r.status === 201).length, stored);
    assert.equal((await comment('m1', test, 'prepozno')).status, 409);
    assert.equal(await count(test), stored);
  });
});
