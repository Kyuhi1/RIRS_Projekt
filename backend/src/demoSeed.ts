// Demo podatki za predajo (docs: README, poglavje »Demo podatki«): en trgovec, en mentor (aktivna povezava) in po en
// test v vsakem stanju (draft, submitted, in_review, changes_requested, approved, withdrawn). Vse gre prek javnega API-ja
// delujoče aplikacije, zato so podatki enaki, kot bi jih ustvaril uporabnik. Administrator je račun iz `.env`.
// Skripta je varna za ponovni zagon: če ima demo trgovec že teste, ničesar ne doda.

export const DEMO_PASSWORD = 'Demo-geslo-123';
export const DEMO_TRADER = { name: 'Demo Trgovec', email: 'demo.trader@example.com' };
export const DEMO_MENTOR = { name: 'Demo Mentor', email: 'demo.mentor@example.com' };

interface Reply {
  status: number;
  data: any;
  cookie: string | null;
}
const call = async (base: string, method: string, path: string, cookie: string | null, body?: unknown): Promise<Reply> => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null };
};
const must = (reply: Reply, expected: number[], what: string): Reply => {
  if (!expected.includes(reply.status)) throw new Error(`${what}: strežnik je vrnil ${reply.status} ${JSON.stringify(reply.data)}`);
  return reply;
};
const day = (iso: string) => iso.slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Ustvari demo račune in teste; vrne število ustvarjenih testov (0, če že obstajajo). `log` izpiše potek.
export async function seedDemo(base: string, log: (message: string) => void = () => undefined): Promise<number> {
  const login = async (user: { name: string; email: string }, role: string): Promise<string> => {
    const created = must(await call(base, 'POST', '/api/auth/register', null, { ...user, password: DEMO_PASSWORD, role }), [201, 409], `registracija ${user.email}`);
    const session = must(await call(base, 'POST', '/api/auth/login', null, { email: user.email, password: DEMO_PASSWORD }), [200], `prijava ${user.email}`);
    log(`${created.status === 201 ? 'ustvarjen' : 'obstaja'}: ${user.email} (${role})`);
    return session.cookie!;
  };
  const trader = await login(DEMO_TRADER, 'trader');
  const mentor = await login(DEMO_MENTOR, 'mentor');

  // Povezava mentor–trgovec: mentor povabi, trgovec sprejme (če povezava že obstaja, se ne ponovi).
  const mentorLinks = must(await call(base, 'GET', '/api/mentor-links', mentor), [200], 'povezave mentorja').data as { trader: { email: string } }[];
  if (!mentorLinks.some((l) => l.trader.email === DEMO_TRADER.email)) must(await call(base, 'POST', '/api/mentor-links', mentor, { email: DEMO_TRADER.email }), [201], 'vabilo');
  for (const link of (must(await call(base, 'GET', '/api/mentor-links', trader), [200], 'povezave trgovca').data as { id: number; status: string }[]).filter((l) => l.status === 'invited')) {
    must(await call(base, 'POST', `/api/mentor-links/${link.id}/accept`, trader), [200], 'sprejem vabila');
  }
  log('povezava mentor–trgovec: aktivna');

  const existing = must(await call(base, 'GET', '/api/backtests', trader), [200], 'seznam testov').data as unknown[];
  if (existing.length > 0) {
    log(`demo trgovec ima že ${existing.length} testov, ničesar ne dodam`);
    return 0;
  }

  const instruments = must(await call(base, 'GET', '/api/instruments', trader), [200], 'sredstva').data as { ticker: string; data_from: string | null; data_to: string | null }[];
  const withData = instruments.find((i) => i.data_from && i.data_to);
  if (!withData) throw new Error('Ni cenovnih podatkov (mapa data/, glej README, poglavje »Zgodovinski podatki (Parquet)«): testov ni mogoče izračunati.');
  const from = day(withData.data_from!);
  const last = day(withData.data_to!);
  const strategies = must(await call(base, 'GET', '/api/strategies', trader), [200], 'strategije').data as { id: number; name: string; system: boolean }[];
  const strategyId = (name: string) => {
    const found = strategies.find((s) => s.system && s.name === name);
    if (!found) throw new Error(`Manjka sistemska strategija ${name}`);
    return found.id;
  };

  // Eno dejanje v delovnem procesu (trgovec ali mentor); `body` je telo zahtevka (npr. komentar).
  const act = async (who: string, id: number, action: string, body?: unknown) => must(await call(base, 'POST', `/api/backtests/${id}/${action}`, who, body), [200, 201], action);
  const plan: { state: string; strategy: string; days: number; prop?: string; steps: (id: number) => Promise<unknown> }[] = [
    { state: 'draft', strategy: 'Buy & Hold', days: 2, steps: async () => undefined },
    { state: 'submitted', strategy: 'SMA Crossover', days: 3, steps: (id) => act(trader, id, 'submit') },
    { state: 'in_review', strategy: 'Breakout (Donchian)', days: 3, steps: async (id) => { await act(trader, id, 'submit'); await act(mentor, id, 'start-review'); } },
    {
      state: 'changes_requested', strategy: 'SMA Crossover', days: 2, prop: 'topstep-50k',
      steps: async (id) => {
        await act(trader, id, 'submit');
        await act(mentor, id, 'start-review');
        await act(mentor, id, 'comments', { body: 'Stop loss je pretesen glede na dnevno nihanje.', is_mistake: true });
        await act(mentor, id, 'request-changes');
      },
    },
    { state: 'approved', strategy: 'Buy & Hold', days: 3, prop: 'ftmo-2step-100k', steps: async (id) => { await act(trader, id, 'submit'); await act(mentor, id, 'start-review'); await act(mentor, id, 'approve'); } },
    { state: 'withdrawn', strategy: 'Breakout (Donchian)', days: 2, steps: async (id) => { await act(trader, id, 'submit'); await act(trader, id, 'withdraw'); } },
  ];
  for (const item of plan) {
    const to = addDays(from, item.days) > last ? last : addDays(from, item.days);
    const created = must(
      await call(base, 'POST', '/api/backtests', trader, {
        strategy_id: strategyId(item.strategy), instruments: [withData.ticker], venue_id: 'gross', from, to, ...(item.prop ? { prop_plan_id: item.prop } : {}),
      }),
      [201], `test ${item.state}`,
    );
    await item.steps(created.data.id as number);
    log(`test #${created.data.id}: ${item.state}`);
  }
  return plan.length;
}
