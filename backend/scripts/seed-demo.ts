// Naloži demo podatke v delujočo aplikacijo: node scripts/seed-demo.ts [naslov], privzeto http://localhost:18080.
import { DEMO_MENTOR, DEMO_PASSWORD, DEMO_TRADER, seedDemo } from '../src/demoSeed.ts';
import { seedDemoExtended } from '../src/demoSeedExtended.ts';

const base = (process.argv[2] ?? 'http://localhost:18080').replace(/\/$/, '');
try {
  const created = await seedDemo(base, (message) => console.log(message));
  const extended = await seedDemoExtended(base, (message) => console.log(message));
  console.log(created + extended > 0 ? `\nUstvarjenih testov: ${created + extended}.` : '\nNič novega.');
  console.log(`Prijava: ${DEMO_TRADER.email} (trgovec), ${DEMO_MENTOR.email} (mentor), geslo ${DEMO_PASSWORD}; administrator je račun iz .env.`);
} catch (err) {
  console.error(`Napaka: ${(err as Error).message}`);
  process.exit(1);
}
