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
const count = async (pool: Pool) => (await pool.query('SELECT count(*)::int AS n FROM mentor_links')).rows[0].n as number;

// Dva mentorja, dva trgovca in administrator, vsi prijavljeni.
async function setup(base: string, pool: Pool) {
  const emails = { m1: 'm1@example.com', m2: 'm2@example.com', t1: 't1@example.com', t2: 't2@example.com', admin: 'admin@example.com' };
  await addUser(pool, 'mentor', emails.m1);
  await addUser(pool, 'mentor', emails.m2);
  await addUser(pool, 'trader', emails.t1);
  await addUser(pool, 'trader', emails.t2);
  await addUser(pool, 'admin', emails.admin);
  const cookie = {
    m1: await loginCookie(base, emails.m1),
    m2: await loginCookie(base, emails.m2),
    t1: await loginCookie(base, emails.t1),
    t2: await loginCookie(base, emails.t2),
    admin: await loginCookie(base, emails.admin),
  };
  const invite = async (mentor: 'm1' | 'm2', trader: string) => json(await send(base, 'POST', '/api/mentor-links', cookie[mentor], { email: trader }));
  return { emails, cookie, invite };
}

test('mentor povabi trgovca: nastane povezava invited, e-naslov se normalizira, trgovec vidi vabilo z imenom mentorja', async () => {
  await withApp(async (base, pool) => {
    const { cookie } = await setup(base, pool);
    const res = await send(base, 'POST', '/api/mentor-links', cookie.m1, { email: '  T1@Example.COM ' });
    assert.equal(res.status, 201);
    const link = await json(res);
    assert.equal(link.status, 'invited');
    assert.deepEqual([link.mentor.name, link.trader.name, link.trader.email], ['Test mentor', 'Test trader', 't1@example.com']);
    assert.equal(typeof link.id, 'number');

    const seen = await json(await send(base, 'GET', '/api/mentor-links', cookie.t1));
    assert.deepEqual(seen.map((l: any) => [l.id, l.status, l.mentor.name]), [[link.id, 'invited', 'Test mentor']]);
    assert.equal(seen[0].mentor.email, undefined); // trgovec ne dobi mentorjevega e-naslova
    assert.deepEqual(await json(await send(base, 'GET', '/api/mentor-links', cookie.t2)), []); // drug trgovec ne vidi nič
  });
});

test('vabilo neobstoječega, nepravilnega ali blokiranega naslova ter naslova z drugo vlogo je zavrnjeno z istim razlogom', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails } = await setup(base, pool);
    await addUser(pool, 'trader', 'blocked@example.com', true);
    const before = await count(pool);
    const reason = 'Registriran trgovec s tem e-naslovom ne obstaja';
    for (const email of ['nihce@example.com', emails.m2, emails.admin, 'blocked@example.com', 'ni-naslov']) {
      const res = await send(base, 'POST', '/api/mentor-links', cookie.m1, { email });
      assert.equal(res.status, 400, email);
      assert.equal((await json(res)).errors.email, reason, email);
    }
    for (const body of [{}, { email: '' }, { email: '   ' }, { email: 5 }, null, 'x']) {
      const res = await send(base, 'POST', '/api/mentor-links', cookie.m1, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await json(res)).errors.email, 'Vnesite e-naslov trgovca');
    }
    assert.equal(await count(pool), before);
  });
});

test('drugo vabilo istemu trgovcu je zavrnjeno v vseh stanjih povezave', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const again = async () => {
      const res = await send(base, 'POST', '/api/mentor-links', cookie.m1, { email: emails.t1 });
      assert.equal(res.status, 409);
      return (await json(res)).errors.email as string;
    };
    const link = await invite('m1', emails.t1);
    assert.match(await again(), /že povabili/);
    await send(base, 'POST', `/api/mentor-links/${link.id}/accept`, cookie.t1);
    assert.match(await again(), /že vaš učenec/);
    await send(base, 'POST', `/api/mentor-links/${link.id}/end`, cookie.m1);
    assert.match(await again(), /prekinjena/);

    const declined = await invite('m1', emails.t2);
    await send(base, 'POST', `/api/mentor-links/${declined.id}/decline`, cookie.t2);
    const res = await send(base, 'POST', '/api/mentor-links', cookie.m1, { email: emails.t2 });
    assert.match((await json(res)).errors.email, /zavrnil/);
    assert.equal(await count(pool), 2);

    // drug mentor lahko povabi istega trgovca
    assert.equal((await send(base, 'POST', '/api/mentor-links', cookie.m2, { email: emails.t1 })).status, 201);
  });
});

test('trgovec sprejme ali zavrne vabilo; tuje vabilo in napačno stanje sta zavrnjena', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const a = await invite('m1', emails.t1);
    const b = await invite('m2', emails.t1);

    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.t2)).status, 404); // tuje vabilo
    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.m1)).status, 403); // mentor ne sprejema
    assert.equal((await send(base, 'POST', '/api/mentor-links/99999/accept', cookie.t1)).status, 404);
    assert.equal((await send(base, 'POST', '/api/mentor-links/abc/accept', cookie.t1)).status, 404);

    const accepted = await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.t1);
    assert.equal(accepted.status, 200);
    assert.equal((await json(accepted)).status, 'active');
    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.t1)).status, 409); // že sprejeto
    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/decline`, cookie.t1)).status, 409); // aktivne ni mogoče zavrniti

    const declined = await send(base, 'POST', `/api/mentor-links/${b.id}/decline`, cookie.t1);
    assert.equal((await json(declined)).status, 'declined');
    assert.equal((await send(base, 'POST', `/api/mentor-links/${b.id}/accept`, cookie.t1)).status, 409); // zavrnjenega ni mogoče sprejeti
  });
});

test('trgovec z aktivnim mentorjem ne more sprejeti drugega vabila, po prekinitvi pa lahko', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const a = await invite('m1', emails.t1);
    const b = await invite('m2', emails.t1);
    await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.t1);

    const second = await send(base, 'POST', `/api/mentor-links/${b.id}/accept`, cookie.t1);
    assert.equal(second.status, 409);
    assert.equal((await json(second)).error, 'Že imate aktivnega mentorja');
    assert.equal((await pool.query('SELECT status FROM mentor_links WHERE id = $1', [b.id])).rows[0].status, 'invited'); // vabilo ostane

    await send(base, 'POST', `/api/mentor-links/${a.id}/end`, cookie.t1);
    assert.equal((await send(base, 'POST', `/api/mentor-links/${b.id}/accept`, cookie.t1)).status, 200);
  });
});

test('aktivno povezavo prekine mentor ali trgovec, tretja oseba ne, vabila pa ni mogoče prekiniti', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const a = await invite('m1', emails.t1);
    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/end`, cookie.m1)).status, 409); // še ni aktivna
    await send(base, 'POST', `/api/mentor-links/${a.id}/accept`, cookie.t1);

    for (const stranger of ['m2', 't2']) assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/end`, cookie[stranger as 'm2']!)).status, 404, stranger);
    const ended = await send(base, 'POST', `/api/mentor-links/${a.id}/end`, cookie.m1);
    assert.equal((await json(ended)).status, 'ended');
    assert.equal((await send(base, 'POST', `/api/mentor-links/${a.id}/end`, cookie.m1)).status, 409); // že prekinjena

    const b = await invite('m2', emails.t2);
    await send(base, 'POST', `/api/mentor-links/${b.id}/accept`, cookie.t2);
    assert.equal((await json(await send(base, 'POST', `/api/mentor-links/${b.id}/end`, cookie.t2))).status, 'ended'); // prekine trgovec
  });
});

test('seznam vsebuje samo povezave prijavljenega uporabnika, najnovejše prve', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const a = await invite('m1', emails.t1);
    const b = await invite('m1', emails.t2);
    const c = await invite('m2', emails.t1);
    const ids = async (who: keyof typeof cookie) => (await json(await send(base, 'GET', '/api/mentor-links', cookie[who]))).map((l: any) => l.id);
    assert.deepEqual(await ids('m1'), [b.id, a.id]);
    assert.deepEqual(await ids('m2'), [c.id]);
    assert.deepEqual(await ids('t1'), [c.id, a.id]);
    assert.deepEqual(await ids('t2'), [b.id]);
  });
});

test('povezave zahtevajo prijavo in pravo vlogo', async () => {
  await withApp(async (base, pool) => {
    const { cookie, emails, invite } = await setup(base, pool);
    const link = await invite('m1', emails.t1);
    const calls: [string, string, unknown][] = [
      ['GET', '/api/mentor-links', undefined],
      ['POST', '/api/mentor-links', { email: emails.t2 }],
      ['POST', `/api/mentor-links/${link.id}/accept`, undefined],
      ['POST', `/api/mentor-links/${link.id}/decline`, undefined],
      ['POST', `/api/mentor-links/${link.id}/end`, undefined],
    ];
    for (const [method, path, body] of calls) assert.equal((await send(base, method, path, undefined, body)).status, 401, `${method} ${path}`);
    for (const [method, path, body] of calls) assert.equal((await send(base, method, path, cookie.admin, body)).status, 403, `admin ${method} ${path}`);
    assert.equal((await send(base, 'POST', '/api/mentor-links', cookie.t1, { email: emails.t2 })).status, 403); // trgovec ne vabi
    assert.equal((await send(base, 'POST', `/api/mentor-links/${link.id}/decline`, cookie.m1)).status, 403);
    assert.equal(await count(pool), 1);
  });
});

test('baza zagotavlja en aktiven mentor na trgovca in enoličen par', async () => {
  await withApp(async (_base, pool) => {
    await addUser(pool, 'mentor', 'm1@example.com');
    await addUser(pool, 'mentor', 'm2@example.com');
    await addUser(pool, 'trader', 't1@example.com');
    const id = async (email: string) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;
    const [m1, m2, t1] = [await id('m1@example.com'), await id('m2@example.com'), await id('t1@example.com')];
    const insert = (mentor: string, trader: string, status: string) => pool.query('INSERT INTO mentor_links (mentor_id, trader_id, status) VALUES ($1, $2, $3)', [mentor, trader, status]);
    await insert(m1, t1, 'active');
    await assert.rejects(insert(m2, t1, 'active'), /mentor_links_one_active_mentor_idx/);
    await insert(m2, t1, 'invited'); // vabil je lahko več
    await assert.rejects(insert(m1, t1, 'invited'), /mentor_links_mentor_id_trader_id_key/);
    await assert.rejects(insert(t1, t1, 'invited'), /mentor_links_check/);
    await assert.rejects(insert(m1, m2, 'nesmisel'), /mentor_links_status_check/);
  });
});
