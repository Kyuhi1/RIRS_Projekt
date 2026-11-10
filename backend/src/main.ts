import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { ensureAdmin } from './auth.ts';
import { createCandleStore } from './candles.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';

const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? '';
if (jwtSecret.length < 32) throw new Error('JWT_SECRET mora imeti najmanj 32 znakov');

const pool = createPool();
const applied = await migrate(pool, fileURLToPath(new URL('../db/migrations', import.meta.url)));
console.log(applied.length ? `Izvedene migracije: ${applied.join(', ')}` : 'Baza je posodobljena');

const admin = await ensureAdmin(pool, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
console.log(admin === 'skipped' ? 'ADMIN_EMAIL/ADMIN_PASSWORD nista nastavljena, admin ni ustvarjen' : `Administrator: ${admin}`);

const store = createCandleStore(process.env.DATA_DIR ?? '/data');
createApp(pool, store, jwtSecret).listen(port, () => console.log(`Backend posluša na portu ${port}`));
