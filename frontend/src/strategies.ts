import { deleteJson, errorMessage, getJson } from './api';
import { clearFlash, flash, renderStrategyForm } from './strategyForm';
import { button, emptyState, VISIBILITY_LABELS, visibilityControl, type Visibility } from './ui';

interface Strategy {
  id: number;
  name: string;
  description: string;
  author: string; // »Sistem« pri sistemskih strategijah
  visibility: Visibility;
  mine: boolean;
}
interface Catalog {
  page: number;
  pages: number;
  total: number;
  items: Strategy[];
}

const SOURCES: { key: string; label: string }[] = [
  { key: 'all', label: 'Vse' },
  { key: 'mine', label: 'Moje' },
  { key: 'system', label: 'Sistemske' },
  { key: 'shared', label: 'Deljene' },
];
const SEARCH_MIN = 3;

const cell = (text: string) => {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
};

// Seznam strategij (US-03, US-10): filter po izvoru, iskanje po imenu od 3 znakov, paginacija po 20. Lastne imajo
// dejanja Uredi, Deli (s potrditvijo) in Izbriši (s potrditvijo); tuje deljene strategije so samo za branje.
async function renderList(container: HTMLElement, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = `
    <h2>Strategije</h2>
    <p><a class="button" href="#strategije/nova">Nova strategija</a></p>
    <p class="success" id="flash" role="status"></p>
    <div class="presets" id="source-filters" role="group" aria-label="Filter po izvoru"></div>
    <p><label for="strategy-search">Iskanje po imenu</label>
      <input id="strategy-search" type="search" autocomplete="off" placeholder="Vsaj 3 znaki" />
      <span class="hint" id="search-hint"></span></p>
    <p class="error" id="list-message" role="alert"></p>
    <div id="list"><div class="skeleton" role="status" aria-label="Nalagam"><span></span><span></span><span></span><span></span></div></div>
    <div class="pager" id="pager"></div>`;
  container.querySelector('#flash')!.textContent = flash;
  clearFlash();
  const list = container.querySelector<HTMLElement>('#list')!;
  const pager = container.querySelector<HTMLElement>('#pager')!;
  const message = container.querySelector<HTMLElement>('#list-message')!;
  const search = container.querySelector<HTMLInputElement>('#strategy-search')!;
  const hint = container.querySelector<HTMLElement>('#search-hint')!;
  const bar = container.querySelector<HTMLElement>('#source-filters')!;

  let source = 'all';
  let page = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reload = () => void load();
  const fail = (text: string) => (message.textContent = text);

  const drawFilters = () => {
    bar.replaceChildren(
      ...SOURCES.map(({ key, label }) => {
        const b = button(label, () => {
          source = key;
          page = 1;
          reload();
        });
        b.dataset.filter = key;
        b.classList.toggle('active', key === source);
        return b;
      }),
    );
  };

  const draw = (catalog: Catalog) => {
    pager.replaceChildren();
    if (catalog.items.length === 0 && catalog.total === 0) {
      const add = document.createElement('a');
      add.className = 'button primary';
      add.href = '#strategije/nova';
      add.textContent = 'Naloži novo strategijo';
      list.replaceChildren(emptyState('Ni strategij', 'Naložite prvo strategijo, da lahko zaženete test.', add));
      return;
    }
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Ime</th><th>Opis</th><th>Avtor</th><th>Vidnost</th><th></th></tr></thead><tbody></tbody>';
    const body = table.querySelector('tbody')!;
    for (const s of catalog.items) {
      const row = document.createElement('tr');
      const actions = document.createElement('td');
      actions.className = 'actions';
      if (s.mine) {
        const edit = document.createElement('a');
        edit.href = `#strategije/${s.id}`;
        edit.textContent = 'Uredi';
        const remove = button('Izbriši', () => confirmDelete(actions, s, fail, reload, onUnauthorized));
        actions.append(edit, visibilityControl(`/api/strategies/${s.id}/visibility`, s.visibility, reload, fail, onUnauthorized), remove);
      }
      row.append(cell(s.name), cell(s.description), cell(s.author), cell(VISIBILITY_LABELS[s.visibility]), actions);
      body.append(row);
    }
    list.replaceChildren(table);

    const previous = button('Prejšnja', () => {
      page -= 1;
      reload();
    });
    const next = button('Naslednja', () => {
      page += 1;
      reload();
    });
    previous.disabled = catalog.page <= 1;
    next.disabled = catalog.page >= catalog.pages;
    const info = document.createElement('span');
    info.className = 'hint';
    info.textContent = `Stran ${catalog.page} od ${catalog.pages} (${catalog.total})`;
    pager.append(previous, info, next);
  };

  async function load(): Promise<void> {
    drawFilters();
    const text = search.value.trim();
    hint.textContent = text.length > 0 && [...text].length < SEARCH_MIN ? `Iskanje se začne pri ${SEARCH_MIN} znakih.` : '';
    const query = new URLSearchParams({ source, page: String(page) });
    if ([...text].length >= SEARCH_MIN) query.set('q', text);
    const { status, data } = await getJson(`/api/strategy-catalog?${query}`);
    if (status === 401) return onUnauthorized();
    if (status !== 200) {
      list.replaceChildren();
      pager.replaceChildren();
      fail(errorMessage(data, 'Strategij ni mogoče naložiti.'));
      return;
    }
    fail('');
    draw(data as Catalog);
  }

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      page = 1;
      reload();
    }, 250);
  });
  await load();
}

// Namesto »Izbriši« se pokažeta »Potrdi« in »Prekliči«; napaka (npr. strategija ima teste) se prikaže nad tabelo.
function confirmDelete(actions: HTMLElement, s: Strategy, fail: (message: string) => void, reload: () => void, onUnauthorized: () => void): void {
  fail('');
  const original = [...actions.childNodes];
  const confirm = button(`Potrdi brisanje »${s.name}«`, async () => {
    confirm.disabled = true;
    try {
      const { status, data } = await deleteJson(`/api/strategies/${s.id}`);
      if (status === 401) return onUnauthorized();
      if (status === 200) return reload();
      fail(errorMessage(data, 'Strategije ni bilo mogoče izbrisati.'));
    } catch {
      fail('Strežnik ni dosegljiv, poskusite znova.');
    }
    actions.replaceChildren(...original);
  });
  const cancel = button('Prekliči', () => actions.replaceChildren(...original));
  actions.replaceChildren(confirm, cancel);
}

// Stran Strategije: `#strategije` seznam, `#strategije/nova` nalaganje, `#strategije/<id>` urejanje.
export async function renderStrategies(container: HTMLElement, arg: string | undefined, onUnauthorized: () => void): Promise<void> {
  if (arg === 'nova') return renderStrategyForm(container, null, onUnauthorized);
  if (arg) return renderStrategyForm(container, arg, onUnauthorized);
  return renderList(container, onUnauthorized);
}
