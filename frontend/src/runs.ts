import { errorMessage, getJson } from './api';
import { ASSET_CLASS_LABELS, type Instrument, type Reference } from './refdata';

interface Run {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  visibility: 'private' | 'shared';
  prop_plan: { firm_name: string; plan_name: string } | null;
  challenge_passed: boolean | null;
  summary: { netProfit: number; returnPct: number };
}

const VISIBILITY_LABELS = { private: 'Zasebna', shared: 'Deljena' };

const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

// Seznam zagonov (WF-02): lastni testi z rezultatom; klik odpre rezultate, filter po skupini sredstev.
export async function renderRuns(container: HTMLElement, ref: Reference, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = `
    <h2>Seznam zagonov</h2>
    <div class="presets" id="run-filters" role="group" aria-label="Filter po skupini sredstev"></div>
    <div id="runs-table"><p>Nalagam ...</p></div>`;
  const table = container.querySelector<HTMLElement>('#runs-table')!;

  const { status, data } = await getJson('/api/backtests');
  if (status === 401) return onUnauthorized();
  if (status !== 200) {
    table.innerHTML = '<p class="error"></p>';
    table.querySelector('.error')!.textContent = errorMessage(data, 'Zagonov ni mogoče naložiti.');
    return;
  }
  const runs = data as Run[];

  const classOf = new Map<string, Instrument['asset_class']>(ref.instruments.map((i) => [i.ticker, i.asset_class]));
  const filters: { key: string; label: string }[] = [
    ...Object.entries(ASSET_CLASS_LABELS)
      .filter(([key]) => runs.some((r) => r.instruments.some((t) => classOf.get(t) === key)))
      .map(([key, label]) => ({ key, label })),
    { key: 'all', label: 'Vse' },
  ];
  let active = 'all';

  const draw = () => {
    container.querySelectorAll<HTMLButtonElement>('#run-filters button').forEach((b) => b.classList.toggle('active', b.dataset.filter === active));
    const shown = runs.filter((r) => active === 'all' || r.instruments.some((t) => classOf.get(t) === active));
    if (shown.length === 0) {
      table.innerHTML = '<p>Ni zagonov</p>';
      return;
    }
    table.innerHTML = '<table><thead><tr><th>Zagon</th><th>Obdobje</th><th>Rezultat</th><th>Vidnost</th></tr></thead><tbody></tbody></table>';
    const body = table.querySelector('tbody')!;
    for (const run of shown) {
      const row = document.createElement('tr');
      row.className = 'clickable';
      const name = document.createElement('td');
      const link = document.createElement('a');
      link.href = `#backtests/${run.id}`;
      link.textContent = `#${run.id} ${run.strategy_name}`;
      const details = document.createElement('div');
      details.className = 'hint';
      const plan = run.prop_plan ? ` · ${run.prop_plan.firm_name} ${run.prop_plan.plan_name}: ${run.challenge_passed ? 'izziv opravljen' : 'izziv ni opravljen'}` : '';
      details.textContent = `${run.instruments.join(', ')} · ${run.venue_id}${plan}`;
      name.append(link, details);

      const period = document.createElement('td');
      period.textContent = `${run.from} do ${run.to}`;
      const result = document.createElement('td');
      result.className = run.summary.netProfit >= 0 ? 'positive' : 'negative';
      result.textContent = `${money(run.summary.netProfit)} (${money(run.summary.returnPct)} %)`;
      const visibility = document.createElement('td');
      visibility.textContent = VISIBILITY_LABELS[run.visibility];

      row.append(name, period, result, visibility);
      row.addEventListener('click', () => (location.hash = `backtests/${run.id}`));
      body.append(row);
    }
  };

  const bar = container.querySelector<HTMLElement>('#run-filters')!;
  for (const { key, label } of filters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.filter = key;
    button.textContent = label;
    button.addEventListener('click', () => {
      active = key;
      draw();
    });
    bar.append(button);
  }
  draw();
}
