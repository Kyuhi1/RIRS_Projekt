import { REFERENCE_TABS, renderReferenceTab } from './adminReference';
import { renderUsersTab } from './adminUsers';

const TABS = [...Object.entries(REFERENCE_TABS).map(([key, tab]) => ({ key, label: tab.label })), { key: 'users', label: 'Uporabniki' }];

// Administracija (WF-06): zavihki Venues, Prop plans, Instruments in Uporabniki; vsi z istim vzorcem.
export function renderAdmin(container: HTMLElement, onUnauthorized: () => void): void {
  container.innerHTML = '<h2>Administracija</h2><div class="presets" id="admin-tabs" role="group" aria-label="Podatki"></div><div id="admin-body"></div>';
  const tabs = container.querySelector<HTMLElement>('#admin-tabs')!;
  const body = container.querySelector<HTMLElement>('#admin-body')!;
  const show = (key: string): void => {
    tabs.replaceChildren(
      ...TABS.map((tab) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tab = tab.key;
        b.textContent = tab.label;
        b.classList.toggle('active', tab.key === key);
        b.addEventListener('click', () => show(tab.key));
        return b;
      }),
    );
    if (key === 'users') renderUsersTab(body, onUnauthorized);
    else renderReferenceTab(body, REFERENCE_TABS[key as keyof typeof REFERENCE_TABS].config, onUnauthorized);
  };
  show('users');
}
