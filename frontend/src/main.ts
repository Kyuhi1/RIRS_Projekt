import './style.css';
import { PAGE_TITLES, renderPage } from './pages';
import { renderLogin } from './login';
import { renderRegister } from './register';
import { fetchCurrentUser, logout, ROLE_LABELS, type Role, type User } from './session';

// Navigacija po vlogah (WF-02 do WF-06); prva stran je kam se uporabnik preusmeri po prijavi.
const NAV: Record<Role, string[]> = {
  trader: ['strategije', 'backtests', 'mentor'],
  mentor: ['dashboard', 'ucenci', 'analitika'],
  admin: ['administracija'],
};
// Strani, ki niso v navigaciji: mentor odpre test učenca na »pregled/<id>«.
const HIDDEN_PAGES: Record<Role, string[]> = { trader: [], mentor: ['pregled'], admin: [] };
const PUBLIC_PAGES = ['prijava', 'registracija'];

const app = document.querySelector<HTMLDivElement>('#app')!;
let user: User | null = null;
let notice = ''; // sporočilo na strani za prijavo (po registraciji, po odjavi, ob poteku seje)

const currentHash = () => location.hash.slice(1); // npr. »backtests« ali »backtests/12«

// Preusmeri na stran; če je hash že enak, ponovno izriše.
function go(page: string): void {
  if (currentHash() === page) render();
  else location.hash = page;
}

function expireSession(): void {
  user = null;
  notice = 'Seja je potekla, prijavite se znova.';
  go('prijava');
}

function renderHeader(current: User, page: string): string {
  const links = NAV[current.role]
    .map((p) => `<a href="#${p}"${p === (page === 'pregled' ? 'dashboard' : page) ? ' class="active" aria-current="page"' : ''}>${PAGE_TITLES[p]}</a>`)
    .join('');
  return `
    <header class="top">
      <strong>Backtester</strong>
      <nav aria-label="Glavna navigacija">${links}</nav>
      <div class="user-menu">
        <span id="user-name"></span>
        <button id="logout" type="button">Odjava</button>
      </div>
    </header>`;
}

function renderLoggedOut(page: string): void {
  app.innerHTML = `
    <header class="top">
      <strong>Backtester</strong>
      <nav><a href="#prijava">Prijava</a> <a href="#registracija">Registracija</a></nav>
    </header>
    <main class="panels">
      <section id="prijava"></section>
      <section id="registracija"></section>
    </main>`;
  renderLogin(app.querySelector<HTMLElement>('#prijava')!, notice, (loggedIn) => {
    user = loggedIn;
    notice = '';
    go(NAV[loggedIn.role][0]!);
  });
  // Po registraciji uporabnika preusmerimo na prijavo s potrditvenim sporočilom.
  renderRegister(app.querySelector<HTMLElement>('#registracija')!, (message) => {
    notice = message;
    go('prijava');
  });
  app.querySelector(`#${page}`)?.scrollIntoView();
}

function renderLoggedIn(current: User, page: string, arg?: string): void {
  app.innerHTML = `${renderHeader(current, page)}<main class="page"></main>`;
  app.querySelector<HTMLElement>('#user-name')!.textContent = `${current.name} (${ROLE_LABELS[current.role]})`;
  app.querySelector('#logout')!.addEventListener('click', async () => {
    await logout();
    user = null;
    notice = 'Odjavljeni ste.';
    go('prijava');
  });
  renderPage(app.querySelector<HTMLElement>('main')!, page, expireSession, arg);
}

// Zaščita strani v brskalniku je samo udobje; dostop dejansko preverja backend (ADR 0005).
function render(): void {
  const [page = '', arg] = currentHash().split('/');
  if (!user) {
    if (!PUBLIC_PAGES.includes(page)) return go('prijava');
    return renderLoggedOut(page);
  }
  if (!NAV[user.role].includes(page) && !HIDDEN_PAGES[user.role].includes(page)) return go(NAV[user.role][0]!);
  renderLoggedIn(user, page, arg);
}

window.addEventListener('hashchange', render);
user = await fetchCurrentUser();
render();
