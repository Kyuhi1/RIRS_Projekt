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

// Trgovec t1 z osnutkom testa, mentor m1, drug trgovec t2; povezava je po želji aktivna.
async function setup(base: string, pool: Pool, linked = true) {
  const m1 = await addUser(pool, 'mentor', 'm1@example.com');
  const t1 = await addUser(pool, 'trader', 't1@example.com');
  const t2 = await addUser(pool, 'trader', 't2@example.com');
  const cookie = { m1: await loginCookie(base, m1), t1: await loginCookie(base, t1), t2: await loginCookie(base, t2) };
  const ids = async (email: string) => Number((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id);
  const mentorId = await ids(m1);
  const traderId = await ids(t1);
  if (linked) await pool.query("INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, 'active')", [mentorId, traderId]);
  const strategy = (await pool.query('SELECT id FROM strategies LIMIT 1')).rows[0].id;
  const draft = async (owner = traderId) =>
    Number((await pool.query(
      `INSERT INTO backtests (owner_id, strategy_id, venue_id, period_from, period_to, results)
       VALUES ($1, $2, 'gross', '2024-01-01', '2024-01-03', '{"trades": []}') RETURNING id`, [owner, strategy])).rows[0].id);
  const history = async (id: number) => (await pool.query('SELECT from_status, to_status, changed_by::int AS by FROM status_history WHERE backtest_id = $1 ORDER BY id', [id])).rows;
  return { cookie, mentorId, traderId, draft, history };
}

test('oddaja: osnutek postane submitted, mentor je nastavljen, prehod je zapisan z uporabnikom in časom', async () => {
  await withApp(async (base, pool) => {
    const { cookie, mentorId, traderId, draft, history } = await setup(base, pool);
    const id = await draft();
    const res = await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, 'submitted');
    assert.deepEqual(body.reviewer, { id: mentorId, name: 'Test mentor' });
    assert.equal(body.history.length, 1);
    assert.deepEqual([body.history[0].from_status, body.history[0].to_status, body.history[0].changed_by.id], ['draft', 'submitted', traderId]);
    assert.ok(!Number.isNaN(Date.parse(body.history[0].changed_at)));
    assert.deepEqual(await history(id), [{ from_status: 'draft', to_status: 'submitted', by: traderId }]);
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.t1))).status, 'submitted');
  });
});

test('oddaja brez aktivnega mentorja je zavrnjena (409), test ostane osnutek in brez zgodovine', async () => {
  await withApp(async (base, pool) => {
    const { cookie, traderId, mentorId, draft, history } = await setup(base, pool, false);
    const id = await draft();
    for (const status of ['invited', 'declined', 'ended']) {
      await pool.query('DELETE FROM mentor_links');
      await pool.query('INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, $3)', [mentorId, traderId, status]);
      assert.equal((await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1)).status, 409, status);
    }
    await pool.query('DELETE FROM mentor_links');
    const res = await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1);
    assert.equal(res.status, 409);
    assert.match((await json(res)).error, /aktivnega mentorja/);
    const body = await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.t1));
    assert.deepEqual([body.status, body.reviewer, body.history], ['draft', null, []]);
    assert.deepEqual(await history(id), []);
  });
});

test('ponovna oddaja je zavrnjena in ne podvoji zgodovine', async () => {
  await withApp(async (base, pool) => {
    const { cookie, draft, history } = await setup(base, pool);
    const id = await draft();
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1)).status, 200);
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1)).status, 409);
    assert.equal((await history(id)).length, 1);
  });
});

test('umik: submitted postane withdrawn, mentor ostane zapisan, zgodovina ima oba prehoda', async () => {
  await withApp(async (base, pool) => {
    const { cookie, mentorId, traderId, draft, history } = await setup(base, pool);
    const id = await draft();
    await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1);
    const res = await send(base, 'POST', `/api/backtests/${id}/withdraw`, cookie.t1);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, 'withdrawn');
    assert.equal(body.reviewer.id, mentorId);
    assert.deepEqual(body.history.map((h: any) => [h.from_status, h.to_status]), [['draft', 'submitted'], ['submitted', 'withdrawn']]);
    assert.deepEqual(await history(id), [
      { from_status: 'draft', to_status: 'submitted', by: traderId },
      { from_status: 'submitted', to_status: 'withdrawn', by: traderId },
    ]);
    // umaknjenega testa ni mogoče znova oddati ali znova umakniti
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1)).status, 409);
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/withdraw`, cookie.t1)).status, 409);
  });
});

test('umik osnutka in umik testa, ki je že v pregledu, sta zavrnjena (409) brez sprememb', async () => {
  await withApp(async (base, pool) => {
    const { cookie, mentorId, draft, history } = await setup(base, pool);
    const id = await draft();
    assert.equal((await send(base, 'POST', `/api/backtests/${id}/withdraw`, cookie.t1)).status, 409);
    await send(base, 'POST', `/api/backtests/${id}/submit`, cookie.t1);
    await pool.query("UPDATE backtests SET status = 'in_review' WHERE id = $1", [id]); // mentor je pregled začel
    const res = await send(base, 'POST', `/api/backtests/${id}/withdraw`, cookie.t1);
    assert.equal(res.status, 409);
    assert.match((await json(res)).error, /mentor pregleda ni začel/);
    const body = await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.t1));
    assert.deepEqual([body.status, body.reviewer.id, body.history.length], ['in_review', mentorId, 1]);
    assert.equal((await history(id)).length, 1);
  });
});

test('tuj, neobstoječ ali nepravilen test je 404, mentor in nepravilna prijava pa nimajo dostopa', async () => {
  await withApp(async (base, pool) => {
    const { cookie, draft } = await setup(base, pool);
    const id = await draft();
    for (const action of ['submit', 'withdraw']) {
      assert.equal((await send(base, 'POST', `/api/backtests/${id}/${action}`, cookie.t2)).status, 404, action); // drug trgovec
      assert.equal((await send(base, 'POST', `/api/backtests/999999/${action}`, cookie.t1)).status, 404, action);
      assert.equal((await send(base, 'POST', `/api/backtests/abc/${action}`, cookie.t1)).status, 404, action);
      assert.equal((await send(base, 'POST', `/api/backtests/${id}/${action}`, cookie.m1)).status, 403, action); // mentor
      assert.equal((await send(base, 'POST', `/api/backtests/${id}/${action}`)).status, 401, action);
      assert.equal((await send(base, 'GET', `/api/backtests/${id}/${action}`, cookie.t1)).status, 405, action);
    }
    assert.equal((await json(await send(base, 'GET', `/api/backtests/${id}`, cookie.t1))).status, 'draft');
  });
});

test('GET testa brez oddaje vrne reviewer null in prazno zgodovino, seznam pa stanje in mentorja', async () => {
  await withApp(async (base, pool) => {
    const { cookie, mentorId, draft } = await setup(base, pool);
    const a = await draft();
    const b = await draft();
    await send(base, 'POST', `/api/backtests/${b}/submit`, cookie.t1);
    const one = await json(await send(base, 'GET', `/api/backtests/${a}`, cookie.t1));
    assert.deepEqual([one.reviewer, one.history], [null, []]);
    const list = await json(await send(base, 'GET', '/api/backtests', cookie.t1));
    assert.deepEqual(list.map((t: any) => [t.id, t.status, t.reviewer?.id ?? null]), [[b, 'submitted', mentorId], [a, 'draft', null]]);
  });
});
