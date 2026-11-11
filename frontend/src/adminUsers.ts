import { errorMessage, getJson, patchJson, postJson } from './api';
import { buildForm, type Field } from './adminForm';
import { button } from './ui';

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'trader' | 'mentor' | 'admin';
  blocked: boolean;
}
interface Page {
  page: number;
  pages: number;
  total: number;
  items: AdminUser[];
}

const ROLES = [
  { value: 'trader', label: 'Trgovec' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'admin', label: 'Administrator' },
];
const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;

const EDIT_FIELDS: Field[] = [
  { name: 'name', label: 'Ime', type: 'text' },
  { name: 'role', label: 'Vloga', type: 'select', options: ROLES, hint: 'Nova vloga velja od naslednjega zahtevka uporabnika.' },
  { name: 'blocked', label: 'Blokiran', type: 'checkbox' },
];
const CREATE_FIELDS: Field[] = [
  { name: 'name', label: 'Ime', type: 'text' },
  { name: 'email', label: 'E-naslov', type: 'email' },
  { name: 'password', label: 'Geslo', type: 'password', hint: 'Najmanj 8 znakov.' },
  { name: 'role', label: 'Vloga', type: 'select', options: ROLES },
];

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Zavihek Uporabniki: seznam z iskanjem in paginacijo (20), »+ Dodaj« in panel »Urejanje uporabnika«.
export function renderUsersTab(box: HTMLElement, onUnauthorized: () => void): void {
  box.innerHTML = '<div class="split"><section id="admin-list"></section><section id="admin-panel"></section></div>';
  const list = box.querySelector<HTMLElement>('#admin-list')!;
  const panel = box.querySelector<HTMLElement>('#admin-panel')!;

  const bar = make('div', 'compare-bar');
  const search = make('input');
  search.type = 'search';
  search.id = 'admin-search';
  search.placeholder = 'Išči po imenu ali e-naslovu';
  search.setAttribute('aria-label', 'Išči po imenu ali e-naslovu');
  const add = button('+ Dodaj', () => openForm(null));
  add.id = 'admin-add';
  bar.append(search, add);
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  const table = make('div');
  const pager = make('div', 'pager');
  list.append(bar, message, table, pager);

  let page = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      page = 1;
      void load();
    }, 250);
  });

  const load = async (): Promise<void> => {
    const { status, data } = await getJson(`/api/admin/users?q=${encodeURIComponent(search.value.trim())}&page=${page}`);
    if (status === 401) return onUnauthorized();
    if (status !== 200) return void (message.textContent = errorMessage(data, 'Seznama ni mogoče naložiti.'));
    const result = data as Page;
    if (result.items.length === 0 && result.total > 0 && page > 1) {
      page = result.pages;
      return load();
    }
    if (result.items.length === 0) {
      table.replaceChildren(make('p', 'hint', search.value.trim() ? 'Ni zadetkov.' : 'Ni uporabnikov.'));
      return void pager.replaceChildren();
    }
    const t = make('table');
    t.innerHTML = '<thead><tr><th>Ime</th><th>E-naslov</th><th>Vloga</th><th>Stanje</th><th></th></tr></thead>';
    const body = t.createTBody();
    for (const user of result.items) {
      const row = body.insertRow();
      row.insertCell().textContent = user.name;
      row.insertCell().textContent = user.email;
      row.insertCell().textContent = roleLabel(user.role);
      const state = row.insertCell();
      state.textContent = user.blocked ? 'Blokiran' : 'Aktiven';
      if (user.blocked) state.className = 'negative';
      const actions = row.insertCell();
      actions.className = 'actions';
      actions.append(button('Uredi', () => openForm(user)));
    }
    table.replaceChildren(t);
    const prev = button('Prejšnja', () => {
      page -= 1;
      void load();
    });
    prev.disabled = result.page <= 1;
    const next = button('Naslednja', () => {
      page += 1;
      void load();
    });
    next.disabled = result.page >= result.pages;
    pager.replaceChildren(prev, make('span', 'hint', `Stran ${result.page} od ${result.pages} (${result.total})`), next);
  };

  const openForm = (user: AdminUser | null): void => {
    message.textContent = '';
    const creating = user === null;
    const form = buildForm(creating ? CREATE_FIELDS : EDIT_FIELDS, user ? { ...user } : { role: 'trader' });
    const save = button('Shrani', () => undefined);
    save.type = 'submit';
    const cancel = button('Prekliči', () => panel.replaceChildren());
    const actions = make('div', 'review-actions');
    actions.append(save, cancel);
    form.element.append(actions);
    form.element.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const { status, data } = creating ? await postJson('/api/admin/users', form.values()) : await patchJson(`/api/admin/users/${user!.id}`, form.values());
        if (status === 401) return onUnauthorized();
        if (status === 200 || status === 201) {
          panel.replaceChildren();
          return await load();
        }
        const errors = data && typeof data === 'object' && 'errors' in data ? (data.errors as Record<string, string>) : {};
        // razlog zavrnitve (npr. zadnji administrator) se prikaže v obrazcu
        form.showErrors(errors, Object.keys(errors).length ? '' : errorMessage(data, 'Računa ni bilo mogoče shraniti.'));
      } catch {
        form.showErrors({}, 'Strežnik ni dosegljiv, poskusite znova.');
      } finally {
        save.disabled = false;
      }
    });
    const card = make('section', 'card');
    card.append(make('h3', undefined, creating ? 'Nov račun' : 'Urejanje uporabnika'), form.element);
    panel.replaceChildren(card);
  };

  void load().catch(() => (message.textContent = 'Strežnik ni dosegljiv, poskusite znova.'));
}
