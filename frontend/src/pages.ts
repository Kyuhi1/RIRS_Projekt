import { errorMessage, getJson } from './api';

// Strani za posamezne vloge. Vsebina razen administracije sledi v naslednjih nalogah.
export const PAGE_TITLES: Record<string, string> = {
  strategije: 'Strategije',
  backtests: 'Backtests',
  mentor: 'Mentor',
  dashboard: 'Dashboard',
  ucenci: 'Učenci',
  analitika: 'Analitika',
  administracija: 'Database',
};

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  blocked: boolean;
}

const cell = (text: string) => {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
};

// Administracija: seznam uporabnikov (zahteva vlogo admin, strežnik sicer vrne 403).
async function renderAdmin(container: HTMLElement, onUnauthorized: () => void): Promise<void> {
  const { status, data } = await getJson('/api/admin/users');
  if (status === 401) return onUnauthorized();
  if (status !== 200) {
    container.insertAdjacentHTML('beforeend', '<p class="error"></p>');
    container.querySelector('.error')!.textContent = errorMessage(data, 'Seznama ni mogoče naložiti.');
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>E-naslov</th><th>Ime</th><th>Vloga</th><th>Blokiran</th></tr></thead><tbody></tbody>';
  for (const user of data as AdminUser[]) {
    const row = document.createElement('tr');
    row.append(cell(user.email), cell(user.name), cell(user.role), cell(user.blocked ? 'da' : 'ne'));
    table.querySelector('tbody')!.append(row);
  }
  container.append(table);
}

export function renderPage(container: HTMLElement, page: string, onUnauthorized: () => void): void {
  container.innerHTML = '<h2></h2>';
  container.querySelector('h2')!.textContent = PAGE_TITLES[page] ?? page;
  if (page === 'administracija') void renderAdmin(container, onUnauthorized).catch(() => undefined);
  else container.insertAdjacentHTML('beforeend', '<p>Ta stran bo na voljo v naslednjih korakih razvoja.</p>');
}
