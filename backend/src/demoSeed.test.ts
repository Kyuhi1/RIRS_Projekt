import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_MENTOR, DEMO_PASSWORD, DEMO_TRADER, seedDemo } from './demoSeed.ts';
import { loginCookie, withApp } from './testApp.ts';
import { writeTestParquet } from './testData.ts';

const get = async (base: string, path: string, cookie: string) => (await fetch(base + path, { headers: { Cookie: cookie } })).json() as Promise<any>;

test('demo podatki: trgovec, mentor z aktivno povezavo in test v vsakem stanju; ponovni zagon ničesar ne podvoji', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-'));
  try {
    await writeTestParquet(dir, 'BTCUSDT', 'a.parquet', Date.UTC(2024, 0, 1), 4 * 1440);
    await withApp(async (base) => {
      assert.equal(await seedDemo(base), 6);
      const trader = await loginCookie(base, DEMO_TRADER.email, DEMO_PASSWORD);
      const mentor = await loginCookie(base, DEMO_MENTOR.email, DEMO_PASSWORD);

      const tests = await get(base, '/api/backtests', trader);
      assert.deepEqual(tests.map((t: any) => t.status).sort(), ['approved', 'changes_requested', 'draft', 'in_review', 'submitted', 'withdrawn']);
      assert.ok(tests.every((t: any) => t.summary.tradeCount >= 0 && t.visibility === 'private'));
      assert.ok(tests.some((t: any) => t.prop_plan)); // vsaj en test s financiranim računom

      // mentor ima aktivnega učenca in vidi oddane teste (ne osnutka ali umaknjenega)
      const students = await get(base, '/api/mentor/students', mentor);
      assert.deepEqual(students.map((s: any) => [s.email, s.test_count, s.waiting_count]), [[DEMO_TRADER.email, 4, 1]]);
      const changes = tests.find((t: any) => t.status === 'changes_requested');
      const comments = await get(base, `/api/backtests/${changes.id}/comments`, mentor);
      assert.ok(JSON.stringify(comments).includes('is_mistake'));

      assert.equal(await seedDemo(base), 0); // ponovni zagon
      assert.equal((await get(base, '/api/backtests', trader)).length, 6);
      assert.equal((await get(base, '/api/mentor-links', mentor)).length, 1);
    }, dir);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('demo podatki brez cenovnih podatkov: jasna napaka s sklicem na README, računi in povezava pa so ustvarjeni', async () => {
  await withApp(async (base) => {
    await assert.rejects(() => seedDemo(base), /Zgodovinski podatki \(Parquet\)/);
    const mentor = await loginCookie(base, DEMO_MENTOR.email, DEMO_PASSWORD);
    assert.equal((await get(base, '/api/mentor-links', mentor))[0].status, 'active');
  });
});
