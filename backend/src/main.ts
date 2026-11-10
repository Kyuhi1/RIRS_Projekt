import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { createCandleStore } from './candles.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';

const port = Number(process.env.PORT ?? 3000);

const pool = createPool();
const applied = await migrate(pool, fileURLToPath(new URL('../db/migrations', import.meta.url)));
console.log(applied.length ? `Izvedene migracije: ${applied.join(', ')}` : 'Baza je posodobljena');

const store = createCandleStore(process.env.DATA_DIR ?? '/data');
createApp(pool, store).listen(port, () => console.log(`Backend posluša na portu ${port}`));
