import { errorMessage, getJson, postJson } from './api';
import { statusLabel } from './status';

interface Item {
  id: number;
  strategy_name: string;
  status: string;
  owner: { id: number; name: string };
  instruments: string[];
  submitted_at: string | null;
}
interface Queue {
  page: number;
  pages: number;
  total: number;
  items: Item[];
}

const TABS: { status: string; label: string }[] = [
  { status: 'submitted', label: 'Oddani' },
  { status: 'in_review', label: 'V pregledu' },
  { status: 'changes_requested', label: 'Spremembe' },
  { status: 'approved', label: 'Odobreni' },
];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = make('button', undefined, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }) : '–');

// »Zagoni za pregled« (WF-04): zavihki po stanju, tabela s 20 testi na stran in »Začni pregled« pri oddanih.
export function renderReviewQueue(box: HTMLElement, onUnauthorized: () => void): void {
  let status = 'submitted';
  let page = 1;

  const tabs = make('div', 'presets');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Stanje testov');
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  const table = make('div');
  const pager = make('div', 'pager');
  box.append(tabs, message, table, pager);

  const drawTabs = () => {
    tabs.replaceChildren(
      ...TABS.map(({ status: key, label }) => {
        const tab = button(label, () => {
          status = key;
          page = 1;
          void load();
        });
        tab.classList.toggle('active', key === status);
        return tab;
      }),
    );
  };

  const start = async (item: Item) => {
    message.textContent = '';
    try {
      const { status: code, data } = await postJson(`/api/backtests/${item.id}/start-review`);
      if (code === 401) return onUnauthorized();
      if (code === 200) {
        location.hash = `pregled/${item.id}`; // po začetku se odpre stran pregleda
        return;
      }
      message.textContent = errorMessage(data, 'Pregleda ni mogoče začeti.');
      if (code === 404 || code === 409) setTimeout(() => void load(), 1500); // stanje se je medtem spremenilo
    } catch {
      message.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
    }
  };

  const draw = (queue: Queue) => {
    pager.replaceChildren();
    if (queue.items.length === 0 && queue.total === 0) {
      table.replaceChildren(make('p', 'hint', 'Ni testov v tem stanju.'));
      return;
    }
    const grid = make('table');
    grid.innerHTML = '<thead><tr><th>Zagon</th><th>Učenec</th><th>Oddano</th><th>Stanje</th><th></th></tr></thead>';
    const body = grid.createTBody();
    for (const item of queue.items) {
      const row = body.insertRow();
      const run = row.insertCell();
      const link = make('a', undefined, `#${item.id} ${item.strategy_name}`);
      link.href = `#pregled/${item.id}`;
      run.append(link, make('div', 'hint', item.instruments.join(', ')));
      row.insertCell().textContent = item.owner.name;
      row.insertCell().textContent = when(item.submitted_at);
      row.insertCell().append(make('span', 'badge', statusLabel(item.status)));
      const action = row.insertCell();
      action.append(item.status === 'submitted' ? button('Začni pregled', () => void start(item)) : button('Odpri', () => (location.hash = `pregled/${item.id}`)));
    }
    table.replaceChildren(grid);

    const previous = button('Prejšnja', () => {
      page -= 1;
      void load();
    });
    const next = button('Naslednja', () => {
      page += 1;
      void load();
    });
    previous.disabled = queue.page <= 1;
    next.disabled = queue.page >= queue.pages;
    pager.append(previous, make('span', 'hint', `Stran ${queue.page} od ${queue.pages} (${queue.total})`), next);
  };

  const load = async () => {
    drawTabs();
    table.replaceChildren(make('p', undefined, 'Nalagam ...'));
    pager.replaceChildren();
    try {
      const { status: code, data } = await getJson(`/api/mentor/backtests?status=${status}&page=${page}`);
      if (code === 401) return onUnauthorized();
      if (code !== 200) {
        table.replaceChildren();
        message.textContent = errorMessage(data, 'Testov ni mogoče naložiti.');
        return;
      }
      message.textContent = '';
      draw(data as Queue);
    } catch {
      table.replaceChildren();
      message.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
    }
  };

  void load();
}
