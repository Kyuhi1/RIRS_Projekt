import { deleteJson, errorMessage, getJson, postJson, putJson } from './api';
import { buildForm, type Field } from './adminForm';
import { ASSET_CLASS_LABELS } from './refdata';
import { button, confirmButton, emptyState } from './ui';

type Row = Record<string, any>;
interface Config {
  path: string; // /api/admin/<path>
  noun: string; // »borza« v naslovih panela
  key: string; // ime ključnega polja
  columns: { label: string; value: (row: Row) => string }[];
  fields: Field[];
  search: string; // oznaka polja za iskanje
}

const percent = (fraction: number) => `${+(fraction * 100).toFixed(4)} %`;
const money = (value: number) => value.toLocaleString('de-DE');
const yesNo = (value: boolean) => (value ? 'da' : 'ne');

// Isti vzorec za borze, načrte in sredstva (WF-06): iskanje, »+ Dodaj«, tabela in panel za urejanje.
export const REFERENCE_TABS: Record<'venues' | 'prop-plans' | 'instruments', { label: string; config: Config }> = {
  venues: {
    label: 'Venues',
    config: {
      path: 'venues', noun: 'borze', key: 'id', search: 'Išči po id-ju ali imenu',
      columns: [
        { label: 'Id', value: (r) => r.id }, { label: 'Ime', value: (r) => r.name }, { label: 'Provizija maker', value: (r) => percent(r.maker_pct) },
        { label: 'Provizija taker', value: (r) => percent(r.taker_pct) }, { label: 'Plača razpon', value: (r) => yesNo(r.pay_spread) },
      ],
      fields: [
        { name: 'id', label: 'Id', type: 'text', hint: 'Male črke, števke in vezaji; po ustvarjanju se ne spreminja.' },
        { name: 'name', label: 'Ime', type: 'text' },
        { name: 'maker_pct', label: 'Provizija maker (delež vrednosti posla)', type: 'number', hint: 'Npr. 0.0005 pomeni 0,05 %.' },
        { name: 'taker_pct', label: 'Provizija taker (delež vrednosti posla)', type: 'number' },
        { name: 'pay_spread', label: 'Plača izmerjeni razpon (bid-ask)', type: 'checkbox' },
      ],
    },
  },
  'prop-plans': {
    label: 'Prop plans',
    config: {
      path: 'prop-plans', noun: 'načrta', key: 'id', search: 'Išči po id-ju, podjetju ali načrtu',
      columns: [
        { label: 'Id', value: (r) => r.id }, { label: 'Podjetje', value: (r) => r.firm_name }, { label: 'Načrt', value: (r) => r.plan_name },
        { label: 'Račun', value: (r) => money(r.account_size) }, { label: 'Dnevna izguba', value: (r) => money(r.max_daily_loss) },
        { label: 'Skupna izguba', value: (r) => money(r.max_total_loss) }, { label: 'Cilj', value: (r) => money(r.profit_target) },
      ],
      fields: [
        { name: 'id', label: 'Id', type: 'text', hint: 'Male črke, števke in vezaji; po ustvarjanju se ne spreminja.' },
        { name: 'firm_name', label: 'Podjetje', type: 'text' }, { name: 'plan_name', label: 'Načrt', type: 'text' },
        { name: 'account_size', label: 'Velikost računa', type: 'number', hint: 'Zneski morajo biti večji od 0.' },
        { name: 'max_daily_loss', label: 'Največja dnevna izguba', type: 'number' },
        { name: 'max_total_loss', label: 'Največja skupna izguba', type: 'number' },
        { name: 'profit_target', label: 'Cilj dobička', type: 'number' },
      ],
    },
  },
  instruments: {
    label: 'Instruments',
    config: {
      path: 'instruments', noun: 'sredstva', key: 'ticker', search: 'Išči po oznaki ali opisu',
      columns: [
        { label: 'Oznaka', value: (r) => r.ticker }, { label: 'Opis', value: (r) => r.description },
        { label: 'Skupina', value: (r) => (ASSET_CLASS_LABELS as Record<string, string>)[r.asset_class] ?? r.asset_class },
      ],
      fields: [
        { name: 'ticker', label: 'Oznaka', type: 'text', hint: 'Velike črke, števke in znaki . _ - ; po ustvarjanju se ne spreminja.' },
        { name: 'description', label: 'Opis', type: 'text' },
        { name: 'asset_class', label: 'Skupina sredstev', type: 'select', options: Object.entries(ASSET_CLASS_LABELS).map(([value, label]) => ({ value, label })) },
      ],
    },
  },
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Zavihek s seznamom (levo) in panelom za urejanje (desno).
export function renderReferenceTab(box: HTMLElement, config: Config, onUnauthorized: () => void): void {
  box.innerHTML = '<div class="split"><section id="admin-list"></section><section id="admin-panel"></section></div>';
  const list = box.querySelector<HTMLElement>('#admin-list')!;
  const panel = box.querySelector<HTMLElement>('#admin-panel')!;

  const bar = make('div', 'compare-bar');
  const search = make('input');
  search.type = 'search';
  search.id = 'admin-search';
  search.placeholder = config.search;
  search.setAttribute('aria-label', config.search);
  const add = button('+ Dodaj', () => edit(null));
  add.id = 'admin-add';
  bar.append(search, add);
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  const table = make('div');
  list.append(bar, message, table);

  const fail = (status: number, data: unknown) => {
    if (status === 401) return onUnauthorized();
    message.textContent = errorMessage(data, 'Zahteve ni bilo mogoče izvesti.');
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), 250);
  });

  const load = async (): Promise<void> => {
    const { status, data } = await getJson(`/api/admin/${config.path}?q=${encodeURIComponent(search.value.trim())}`);
    if (status !== 200) return fail(status, data);
    const rows = data as Row[];
    if (rows.length === 0) return void table.replaceChildren(emptyState(search.value.trim() ? 'Ni zadetkov' : 'Ni zapisov'));
    const t = make('table');
    t.innerHTML = `<thead><tr>${config.columns.map(() => '<th></th>').join('')}<th></th><th></th></tr></thead>`;
    t.querySelectorAll('th').forEach((th, i) => (th.textContent = i < config.columns.length ? config.columns[i]!.label : i === config.columns.length ? 'Testi' : ''));
    const body = t.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const column of config.columns) tr.insertCell().textContent = column.value(row);
      tr.insertCell().textContent = String(row.used_by);
      const actions = tr.insertCell();
      actions.className = 'actions';
      const del = row.used_by > 0
        ? Object.assign(button('Izbriši', () => undefined), { disabled: true, title: `Izbris ni mogoč: zapis uporablja ${row.used_by} ${row.used_by === 1 ? 'test' : 'testov'}.` })
        : confirmButton('Izbriši', 'Potrdi izbris', () => void remove(row));
      actions.append(button('Uredi', () => edit(row)), del);
    }
    table.replaceChildren(t);
  };

  const remove = async (row: Row): Promise<void> => {
    message.textContent = '';
    const { status, data } = await deleteJson(`/api/admin/${config.path}/${encodeURIComponent(row[config.key])}`);
    if (status === 200) {
      panel.replaceChildren();
      return load();
    }
    fail(status, data);
    await load();
  };

  const edit = (row: Row | null): void => {
    message.textContent = '';
    const creating = row === null;
    const form = buildForm(config.fields, row ?? { pay_spread: false }, creating ? [] : [config.key]);
    const save = button('Shrani', () => void submit());
    save.type = 'submit';
    const cancel = button('Prekliči', () => panel.replaceChildren());
    const actions = make('div', 'review-actions');
    actions.append(save, cancel);
    form.element.append(actions);
    form.element.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
    });
    const submit = async (): Promise<void> => {
      save.disabled = true;
      try {
        const values = form.values();
        const { status, data } = creating
          ? await postJson(`/api/admin/${config.path}`, values)
          : await putJson(`/api/admin/${config.path}/${encodeURIComponent(row![config.key])}`, values);
        if (status === 401) return onUnauthorized();
        if (status === 200 || status === 201) {
          panel.replaceChildren();
          return await load();
        }
        const errors = data && typeof data === 'object' && 'errors' in data ? (data.errors as Record<string, string>) : {};
        form.showErrors(errors, Object.keys(errors).length ? '' : errorMessage(data, 'Zapisa ni bilo mogoče shraniti.'));
      } catch {
        form.showErrors({}, 'Strežnik ni dosegljiv, poskusite znova.');
      } finally {
        save.disabled = false;
      }
    };
    const card = make('section', 'card');
    card.append(make('h3', undefined, creating ? `Nov zapis (${config.noun})` : `Urejanje ${config.noun}`), form.element);
    panel.replaceChildren(card);
  };

  void load().catch(() => (message.textContent = 'Strežnik ni dosegljiv, poskusite znova.'));
}
