import { errorMessage, getJson } from './api';
import { renderEquityChart, type EquityPoint } from './equityChart';
import { renderTrades } from './trades';

interface Venue {
  id: string;
  name: string;
  maker_pct: number;
  taker_pct: number;
  pay_spread: boolean;
}
interface BacktestDetail {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  params: Record<string, unknown>;
  status: string;
  visibility: 'private' | 'shared';
  results: {
    initialCapital: number;
    finalCapital: number;
    grossProfit: number;
    costs: { commission: number; spread: number; total: number };
    netProfit: number;
    returnPct: number;
    tradeCount: number;
    winRatePct: number;
    maxDrawdownPct: number;
    equityCurve: EquityPoint[];
  };
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Osnutek',
  submitted: 'Oddan mentorju',
  in_review: 'V pregledu',
  changes_requested: 'Zahtevane spremembe',
  approved: 'Odobren',
  withdrawn: 'Umaknjen',
};
const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const sign = (value: number) => (value >= 0 ? 'positive' : 'negative');

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metric(label: string, value: string, className = ''): HTMLElement {
  const box = make('div', 'metric');
  box.append(make('span', 'hint', label), make('strong', className, value));
  return box;
}

function rows(items: [string, string][]): HTMLElement {
  const list = make('dl', 'facts');
  for (const [label, value] of items) list.append(make('dt', undefined, label), make('dd', undefined, value));
  return list;
}

function section(title: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const box = make('section', 'card');
  box.append(make('h3', undefined, title), ...content.map((c) => (typeof c === 'string' ? make('p', 'hint', c) : c)));
  return box;
}

// Stran rezultatov testa (WF-03): glava z nastavitvami, metrike, krivulja, stroški, pravila in posli.
export async function renderResult(container: HTMLElement, id: string, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = '<p>Nalagam ...</p>';
  const [detail, venues] = await Promise.all([getJson(`/api/backtests/${encodeURIComponent(id)}`), getJson('/api/venues')]);
  if (detail.status === 401 || venues.status === 401) return onUnauthorized();

  container.replaceChildren();
  const back = make('p');
  const link = make('a', undefined, '← Nazaj na Backtests');
  link.href = '#backtests';
  back.append(link);
  container.append(back);
  if (detail.status !== 200) {
    container.append(make('p', 'error', errorMessage(detail.data, 'Testa ni mogoče naložiti.')));
    return;
  }

  const t = detail.data as BacktestDetail;
  const r = t.results;
  const venue = venues.status === 200 ? (venues.data as Venue[]).find((v) => v.id === t.venue_id) : undefined;
  const venueName = venue?.name ?? t.venue_id;

  const header = make('header', 'result-head');
  header.append(make('h2', undefined, `Zagon #${t.id}: ${t.strategy_name}`), make('span', 'badge', STATUS_LABELS[t.status] ?? t.status));

  const metrics = make('div', 'metrics');
  metrics.append(
    metric('Neto dobiček', money(r.netProfit), sign(r.netProfit)),
    metric('Donosnost', `${money(r.returnPct)} %`, sign(r.returnPct)),
    metric('Število poslov', String(r.tradeCount)),
    metric('Največji padec', `${r.maxDrawdownPct.toFixed(2)} %`),
    metric('Delež dobičkonosnih', `${r.winRatePct.toFixed(1)} %`),
    metric('Skupni stroški', r.costs.total.toFixed(2)),
  );

  const params = Object.entries(t.params);
  const settings = section(
    'Nastavitve testa',
    rows([
      ['Strategija', t.strategy_name],
      ['Parametri', params.length ? params.map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'brez parametrov'],
      ['Sredstva', t.instruments.join(', ')],
      ['Borza', venueName],
      ['Obdobje', `${t.from} do ${t.to}`],
      ['Začetni kapital', r.initialCapital.toFixed(2)],
      ['Financiran račun', 'ni izbran'],
    ]),
  );

  const chartBox = make('div');
  const chart = section('Krivulja vrednosti računa', chartBox);
  renderEquityChart(chartBox, r.equityCurve, r.initialCapital);

  const costs = section(
    'Stroški borze',
    rows([
      ['Bruto dobiček', money(r.grossProfit)],
      ['Provizije', r.costs.commission.toFixed(2)],
      ['Razpon (spread)', r.costs.spread.toFixed(2)],
      ['Neto dobiček', money(r.netProfit)],
    ]),
  );
  const rules = section('Pravila financiranega računa', 'Preverjanje pravil še ni na voljo; napolni se ob izbiri financiranega računa.');

  const tradesBox = make('div');
  const trades = section('Posli', tradesBox);

  const cards = make('div', 'cards-two');
  cards.append(costs, rules);
  container.append(header, metrics, settings, chart, cards, trades);
  await renderTrades(tradesBox, t.id, onUnauthorized);
}
