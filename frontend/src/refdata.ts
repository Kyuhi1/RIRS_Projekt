import { getJson } from './api';

export interface Instrument {
  ticker: string;
  description: string;
  asset_class: 'crypto' | 'forex' | 'index' | 'gold';
  data_from: string | null; // ISO čas prve svečke; null, če podatkov ni
  data_to: string | null;
  candles: number;
}
export interface Venue {
  id: string;
  name: string;
  maker_pct: number;
  taker_pct: number;
  pay_spread: boolean;
}
export interface PropPlan {
  id: string;
  firm_name: string;
  plan_name: string;
  account_size: number;
  profit_target: number;
  max_daily_loss: number;
  max_total_loss: number;
}
export interface Strategy {
  id: number;
  name: string;
  description: string;
  author: string; // »Sistem« pri sistemskih strategijah
  visibility: 'private' | 'shared';
}
export interface Reference {
  instruments: Instrument[];
  venues: Venue[];
  propPlans: PropPlan[];
  strategies: Strategy[];
}

export const ASSET_CLASS_LABELS: Record<Instrument['asset_class'], string> = {
  crypto: 'Crypto',
  forex: 'Forex',
  index: 'Indeksi',
  gold: 'Zlato',
};

// Naloži referenčne podatke za obrazec. Vrne null, če seja ni več veljavna (401).
export async function loadReference(): Promise<Reference | null> {
  const responses = await Promise.all(['/api/instruments', '/api/venues', '/api/prop-plans', '/api/strategies'].map(getJson));
  if (responses.some((r) => r.status === 401)) return null;
  if (responses.some((r) => r.status !== 200)) throw new Error('Podatkov ni mogoče naložiti');
  const [instruments, venues, propPlans, strategies] = responses.map((r) => r.data);
  return { instruments, venues, propPlans, strategies } as Reference;
}
