import { renderAdmin } from './admin';
import { renderBacktests } from './backtests';
import { renderMentorDashboard, renderTraderMentor } from './mentorLinks';
import { renderResult } from './result';
import { renderStrategies } from './strategies';
import { toast } from './ui';

// Strani za posamezne vloge. Vsebina ostalih strani sledi v naslednjih nalogah.
export const PAGE_TITLES: Record<string, string> = {
  strategije: 'Strategije',
  backtests: 'Backtests',
  mentor: 'Mentor',
  dashboard: 'Dashboard',
  ucenci: 'Učenci',
  analitika: 'Analitika',
  administracija: 'Database',
};

function showError(container: HTMLElement): void {
  container.insertAdjacentHTML('beforeend', '<p class="error">Strežnik ni dosegljiv, poskusite znova.</p>');
  toast('Strežnik ni dosegljiv, poskusite znova.');
}

export function renderPage(container: HTMLElement, page: string, onUnauthorized: () => void, arg?: string): void {
  if (page === 'backtests') return void renderBacktests(container, arg, onUnauthorized).catch(() => showError(container));
  if (page === 'pregled') return void renderResult(container, arg ?? '', onUnauthorized, 'mentor').catch(() => showError(container));
  if (page === 'dashboard') return void renderMentorDashboard(container, onUnauthorized).catch(() => showError(container));
  if (page === 'ucenci' || page === 'analitika') return void renderMentorDashboard(container, onUnauthorized, page).catch(() => showError(container));
  if (page === 'mentor') return void renderTraderMentor(container, onUnauthorized).catch(() => showError(container));
  if (page === 'strategije') return void renderStrategies(container, arg, onUnauthorized).catch(() => showError(container));
  if (page === 'administracija') return renderAdmin(container, onUnauthorized);
  container.innerHTML = '<h2></h2>';
  container.querySelector('h2')!.textContent = PAGE_TITLES[page] ?? page;
  container.insertAdjacentHTML('beforeend', '<p>Ta stran bo na voljo v naslednjih korakih razvoja.</p>');
}
