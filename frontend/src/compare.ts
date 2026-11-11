import { errorMessage, getJson } from './api';
import { renderCompareChart, SERIES_STYLES } from './compareChart';
import type { EquityPoint } from './equityChart';

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

interface Compared {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  params: Record<string, unknown>;
  owner: { id: number; name: string };
  prop_plan: { firm_name: string; plan_name: string } | null;
  challenge_passed: boolean | null;
  results: { initialCapital: number; netProfit: number; returnPct: number; tradeCount: number; winRatePct: number; maxDrawdownPct: number; equityCurve: EquityPoint[] };
}

const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

interface Metric {
  label: string;
  value: (t: Compared) => number;
  format: (value: number) => string;
  better: 'max' | 'min';
}

// Številčne metrike; najboljša vrednost je pri dobičku, donosnosti, številu poslov in deležu zmag največja,
// pri največjem padcu najmanjša. Če so vse vrednosti enake, nič ni označeno.
const METRICS: Metric[] = [
  { label: 'Neto dobiček', value: (t) => t.results.netProfit, format: money, better: 'max' },
  { label: 'Donosnost', value: (t) => t.results.returnPct, format: (v) => `${money(v)} %`, better: 'max' },
  { label: 'Število poslov', value: (t) => t.results.tradeCount, format: (v) => String(v), better: 'max' },
  { label: 'Delež zmagovalnih poslov', value: (t) => t.results.winRatePct, format: (v) => `${v.toFixed(2)} %`, better: 'max' },
  { label: 'Največji padec', value: (t) => t.results.maxDrawdownPct, format: (v) => `${v.toFixed(2)} %`, better: 'min' },
];

function row(label: string, cells: (string | HTMLElement)[], className = ''): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = label;
  tr.append(th);
  for (const content of cells) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.append(content);
    tr.append(td);
  }
  return tr;
}

// Primerjava 2–4 testov (US-09): tabela s tekočimi nastavitvami in metrikami ter skupen graf krivulj.
export async function renderCompare(container: HTMLElement, idsText: string, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = '<p><a href="#backtests">← Nazaj na seznam zagonov</a></p><h2>Primerjava testov</h2><div id="compare-body"><p>Nalagam ...</p></div>';
  const body = container.querySelector<HTMLElement>('#compare-body')!;
  const { status, data } = await getJson(`/api/backtests/compare?ids=${encodeURIComponent(idsText)}`);
  if (status === 401) return onUnauthorized();
  if (status !== 200) {
    const errors = (data as { errors?: Record<string, string> } | null)?.errors;
    body.innerHTML = '<p class="error"></p>';
    body.querySelector('.error')!.textContent =
      status === 404 ? 'Primerjava ni mogoča: eden od testov ne obstaja ali ni dostopen.' : (errors?.ids ?? errorMessage(data, 'Primerjave ni mogoče naložiti.'));
    return;
  }
  const tests = (data as { tests: Compared[] }).tests;

  const table = document.createElement('table');
  table.className = 'compare';
  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  tests.forEach((t, i) => {
    const th = document.createElement('th');
    th.scope = 'col';
    const link = document.createElement('a');
    link.href = `#backtests/${t.id}`;
    link.textContent = `#${t.id}`;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.borderTopColor = SERIES_STYLES[i % SERIES_STYLES.length]!.color;
    swatch.style.borderTopStyle = SERIES_STYLES[i % SERIES_STYLES.length]!.dash ? 'dashed' : 'solid';
    th.append(swatch, link);
    head.append(th);
  });
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  const mono = (text: string) => {
    const code = document.createElement('code');
    code.textContent = text;
    return code;
  };
  tbody.append(
    row('Strategija', tests.map((t) => t.strategy_name)),
    row('Parametri', tests.map((t) => mono(Object.keys(t.params).length ? JSON.stringify(t.params) : '—'))),
    row('Sredstva', tests.map((t) => t.instruments.join(', '))),
    row('Borza', tests.map((t) => t.venue_id)),
    row('Obdobje', tests.map((t) => `${t.from} do ${t.to}`)),
    row('Avtor', tests.map((t) => t.owner.name)),
  );
  for (const metric of METRICS) {
    const values = tests.map(metric.value);
    const best = metric.better === 'max' ? Math.max(...values) : Math.min(...values);
    const distinct = new Set(values).size > 1;
    const tr = row(metric.label, values.map((v) => metric.format(v)));
    tr.querySelectorAll('td').forEach((td, i) => {
      if (distinct && values[i] === best) {
        td.classList.add('best');
        td.title = 'Najboljša vrednost';
        td.append(' ★');
      }
    });
    tbody.append(tr);
  }
  tbody.append(
    row('Preverjanje financiranega računa', tests.map((t) =>
      t.prop_plan ? `${t.prop_plan.firm_name} ${t.prop_plan.plan_name}: ${t.challenge_passed ? 'opravljeno' : 'ni opravljeno'}` : '—')),
  );
  table.append(thead, tbody);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = '★ najboljša vrednost (največji dobiček, donosnost, število poslov in delež zmag; najmanjši padec).';
  const chartBox = document.createElement('div');
  renderCompareChart(chartBox, tests.map((t) => ({ label: `#${t.id} ${t.strategy_name}`, initialCapital: t.results.initialCapital, curve: t.results.equityCurve })));
  const chartTitle = document.createElement('h3');
  chartTitle.textContent = 'Krivulje vrednosti računa (donosnost v %)';
  body.replaceChildren(table, note, chartTitle, chartBox);
}
