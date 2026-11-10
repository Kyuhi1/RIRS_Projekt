import pg from 'pg';

export function createPool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('DATABASE_URL ni nastavljen');
  return new pg.Pool({ connectionString: url });
}
