import { errorMessage, getJson } from './api';
import { statusLabel } from './status';
import { VISIBILITY_LABELS } from './ui';
import { ASSET_CLASS_LABELS, type Instrument, type Reference } from './refdata';

interface Run {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  visibility: 'private' | 'shared';
  owner: { id: number; name: string };
  status: string;
  previous_id: number | null;
  prop_plan: { firm_name: string; plan_name: string } | null;
  challenge_passed: boolean | null;
  summary: { netProfit: number; returnPct: number };
}

const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

// Seznam zagonov (WF-02): lastni testi ali testi, ki so jih drugi delili (samo za branje), z rezultatom;
// klik odpre rezultate, filter po skupini sredstev.
export async function renderRuns(container: HTMLElement, ref: Reference, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = `
    <h2>Seznam zagonov</h2>
    <div class="presets" id="run-scope" role="group" aria-label="Čigavi zagoni"></div>
    <div class="presets" id="run-filters" role="group" aria-label="Filter po skupini sredstev"></div>
    <div id="runs-table"><p>Nalagam ...</p></div>`;
  const table = container.querySelector<HTMLElement>('#runs-table')!;

  let scope: 'mine' | 'shared' = 'mine';
  const scopeBar = container.querySelector<HTMLElement>('#run-scope')!;
  const drawScope = () => {
    scopeBar.replaceChildren(
      ...(['mine', 'shared'] as const).map((key) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.scope = key;
        b.textContent = key === 'mine' ? 'Moji zagoni' : 'Deljeni zagoni';
        b.classList.toggle('active', key === scope);
        b.addEventListener('click', () => {
          scope = key;
          void load();
        });
        return b;
      }),
    );
  };

  let runs: Run[] = [];
  const load = async (): Promise<void> => {
    drawScope();
    table.innerHTML = '<p>Nalagam ...</p>';
    const { status, data } = await getJson(`/api/backtests?scope=${scope}`);
    if (status === 401) return onUnauthorized();
    if (status !== 200) {
      table.innerHTML = '<p class="error"></p>';
      table.querySelector('.error')!.textContent = errorMessage(data, 'Zagonov ni mogoče naložiti.');
      return;
    }
    runs = data as Run[];
    buildFilters();
    draw();
  };

  const classOf = new Map<string, Instrument['asset_class']>(ref.instruments.map((i) => [i.ticker, i.asset_class]));
  let active = 'all';
  const buildFilters = () => {
    const filters: { key: string; label: string }[] = [
      ...Object.entries(ASSET_CLASS_LABELS)
        .filter(([key]) => runs.some((r) => r.instruments.some((t) => classOf.get(t) === key)))
        .map(([key, label]) => ({ key, label })),
      { key: 'all', label: 'Vse' },
    ];
    if (!filters.some((f) => f.key === active)) active = 'all';
    const bar = container.querySelector<HTMLElement>('#run-filters')!;
    bar.replaceChildren(
      ...filters.map(({ key, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.filter = key;
        button.textContent = label;
        button.addEventListener('click', () => {
          active = key;
          draw();
        });
        return button;
      }),
    );
  };

  const draw = () => {
    container.querySelectorAll<HTMLButtonElement>('#run-filters button').forEach((b) => b.classList.toggle('active', b.dataset.filter === active));
    const shown = runs.filter((r) => active === 'all' || r.instruments.some((t) => classOf.get(t) === active));
    if (shown.length === 0) {
      table.innerHTML = `<p>${scope === 'shared' ? 'Nihče ni delil zagonov' : 'Ni zagonov'}</p>`;
      return;
    }
    table.innerHTML = scope === 'shared'
      ? '<table><thead><tr><th>Zagon</th><th>Obdobje</th><th>Rezultat</th><th>Avtor</th></tr></thead><tbody></tbody></table>'
      : '<table><thead><tr><th>Zagon</th><th>Obdobje</th><th>Rezultat</th><th>Stanje</th><th>Vidnost</th></tr></thead><tbody></tbody></table>';
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
      const again = run.previous_id !== null ? ` · ponovitev #${run.previous_id}` : '';
      details.textContent = `${run.instruments.join(', ')} · ${run.venue_id}${plan}${again}`;
      name.append(link, details);

      const period = document.createElement('td');
      period.textContent = `${run.from} do ${run.to}`;
      const result = document.createElement('td');
      result.className = run.summary.netProfit >= 0 ? 'positive' : 'negative';
      result.textContent = `${money(run.summary.netProfit)} (${money(run.summary.returnPct)} %)`;
      const state = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = statusLabel(run.status);
      state.append(badge);
      const visibility = document.createElement('td');
      visibility.textContent = VISIBILITY_LABELS[run.visibility];

      if (scope === 'shared') {
        const author = document.createElement('td');
        author.textContent = run.owner.name;
        row.append(name, period, result, author);
      } else row.append(name, period, result, state, visibility);
      row.addEventListener('click', () => (location.hash = `backtests/${run.id}`));
      body.append(row);
    }
  };

  await load();
}
