import { errorMessage, getJson, postJson } from './api';
import { emptyState } from './ui';
import { renderReviewQueue } from './reviewQueue';
import { renderStudentAnalytics } from './studentAnalytics';

interface Link {
  id: number;
  status: 'invited' | 'active' | 'declined' | 'ended';
  mentor: { id: number; name: string };
  trader: { id: number; name: string; email: string };
}

interface Student {
  id: number;
  test_count: number;
  waiting_count: number;
}

const STATUS_LABELS: Record<Link['status'], string> = {
  invited: 'Vabilo čaka na odgovor',
  active: 'Aktiven',
  declined: 'Zavrnil vabilo',
  ended: 'Povezava prekinjena',
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const panel = (title: string): HTMLElement => {
  const box = make('section', 'card');
  box.append(make('h3', undefined, title));
  return box;
};

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = make('button', undefined, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// Gumb z dvostopenjsko potrditvijo: prvi klik pokaže »Potrdi« in »Prekliči«, šele drugi izvede dejanje.
function confirmButton(label: string, confirmLabel: string, run: () => void): HTMLElement {
  const holder = make('span', 'actions');
  const show = () => holder.replaceChildren(button(label, ask));
  const ask = () => holder.replaceChildren(button(confirmLabel, run), button('Prekliči', show));
  show();
  return holder;
}

// Naloži povezave prijavljenega uporabnika; null pomeni potekla seja (401).
async function loadLinks(): Promise<{ links: Link[] } | { error: string } | null> {
  const { status, data } = await getJson('/api/mentor-links');
  if (status === 401) return null;
  if (status !== 200) return { error: errorMessage(data, 'Povezav ni mogoče naložiti.') };
  return { links: data as Link[] };
}

// Izvede dejanje nad povezavo (sprejem, zavrnitev, prekinitev); ob uspehu osveži stran, ob napaki pokaže razlog.
async function act(id: number, action: 'accept' | 'decline' | 'end', message: HTMLElement, reload: () => void, onUnauthorized: () => void): Promise<void> {
  message.textContent = '';
  try {
    const { status, data } = await postJson(`/api/mentor-links/${id}/${action}`);
    if (status === 401) return onUnauthorized();
    if (status === 200) return reload();
    message.textContent = errorMessage(data, 'Dejanja ni bilo mogoče izvesti.');
    // Stanje se je lahko medtem spremenilo (npr. drugi je prekinil povezavo), zato po napaki prikažemo svežo vsebino.
    if (status === 404 || status === 409) setTimeout(reload, 1500);
  } catch {
    message.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
  }
}

export type MentorView = 'dashboard' | 'ucenci' | 'analitika';
const MENTOR_TITLES: Record<MentorView, string> = { dashboard: 'Nadzorna plošča', ucenci: 'Učenci', analitika: 'Analitika' };

// Mentorjev dashboard (WF-04): levo Učenci in Povabi učenca, desno zagoni za pregled in analitika.
// Strani »Učenci« in »Analitika« v navigaciji prikažeta isti vsebini vsako zase.
export async function renderMentorDashboard(container: HTMLElement, onUnauthorized: () => void, view: MentorView = 'dashboard'): Promise<void> {
  const reload = () => void renderMentorDashboard(container, onUnauthorized, view);
  if (view === 'analitika') {
    container.innerHTML = '<h2>Analitika</h2>';
    const analyticsPage = panel('Skupna analitika učencev');
    container.append(analyticsPage);
    renderStudentAnalytics(analyticsPage, onUnauthorized);
    return;
  }
  const title = MENTOR_TITLES[view];
  container.innerHTML = `<h2>${title}</h2><div class="skeleton" role="status" aria-label="Nalagam"><span></span><span></span><span></span><span></span></div>`;
  const [loaded, counts] = await Promise.all([loadLinks(), getJson('/api/mentor/students')]);
  if (!loaded || counts.status === 401) return onUnauthorized();
  const countOf = new Map((counts.status === 200 ? (counts.data as Student[]) : []).map((s) => [s.id, s]));
  container.innerHTML = `<h2>${title}</h2><div class="split"><div id="left"></div><div id="right"></div></div>`;
  const left = container.querySelector<HTMLElement>('#left')!;
  const right = container.querySelector<HTMLElement>('#right')!;

  // Učenci: aktivni in povabljeni; zavrnjene in prekinjene povezave se prikažejo z oznako stanja.
  const students = panel('Učenci');
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  if ('error' in loaded) {
    message.textContent = loaded.error;
    students.append(message);
  } else if (loaded.links.length === 0) {
    students.append(emptyState('Še nimate učencev', 'Povabite trgovca z e-naslovom.'));
  } else {
    const table = make('table');
    table.innerHTML = '<thead><tr><th>Ime</th><th>Stanje</th><th>Testi</th><th>Čaka</th><th></th></tr></thead>';
    const body = table.createTBody();
    for (const link of loaded.links) {
      const row = body.insertRow();
      const name = row.insertCell();
      name.append(make('div', undefined, link.trader.name), make('div', 'hint', link.trader.email));
      row.insertCell().textContent = STATUS_LABELS[link.status];
      const student = link.status === 'active' ? countOf.get(link.trader.id) : undefined;
      row.insertCell().textContent = student ? String(student.test_count) : '–';
      const waiting = row.insertCell();
      waiting.textContent = student ? String(student.waiting_count) : '–';
      waiting.dataset.waiting = '';
      const actions = row.insertCell();
      actions.className = 'actions';
      if (link.status === 'active') {
        actions.append(confirmButton('Odstrani', 'Potrdi odstranitev', () => void act(link.id, 'end', message, reload, onUnauthorized)));
      }
    }
    students.append(message, table);
  }

  const inviteBox = panel('Povabi učenca');
  const form = make('form');
  form.noValidate = true;
  form.innerHTML = `
    <label for="invite-email">E-naslov trgovca</label>
    <input id="invite-email" name="email" type="email" autocomplete="off" />
    <span class="error" data-error="email"></span>
    <button type="submit">Pošlji vabilo</button>
    <span class="success" role="status" data-status></span>`;
  const field = (name: string) => form.querySelector<HTMLElement>(`[data-error="${name}"]`)!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    field('email').textContent = '';
    const input = form.querySelector<HTMLInputElement>('#invite-email')!;
    const submit = form.querySelector<HTMLButtonElement>('button')!;
    submit.disabled = true;
    try {
      const { status, data } = await postJson('/api/mentor-links', { email: input.value });
      if (status === 401) return onUnauthorized();
      if (status === 201) return reload();
      const errors = data && typeof data === 'object' && 'errors' in data ? (data.errors as Record<string, string>) : {};
      field('email').textContent = errors.email ?? errorMessage(data, 'Vabila ni bilo mogoče poslati.');
    } catch {
      field('email').textContent = 'Strežnik ni dosegljiv, poskusite znova.';
    } finally {
      submit.disabled = false;
    }
  });
  inviteBox.append(form);
  if (view === 'ucenci') {
    left.append(students);
    right.append(inviteBox);
    return;
  }
  left.append(students, inviteBox);

  const queue = panel('Zagoni za pregled');
  renderReviewQueue(queue, onUnauthorized);
  const analytics = panel('Skupna analitika učencev');
  renderStudentAnalytics(analytics, onUnauthorized);
  right.append(queue, analytics);
}

// Stran Mentor trgovca: čakajoča vabila (sprejmi ali zavrni) in trenutni mentor (prekini povezavo).
export async function renderTraderMentor(container: HTMLElement, onUnauthorized: () => void): Promise<void> {
  const reload = () => void renderTraderMentor(container, onUnauthorized);
  container.innerHTML = '<h2>Mentor</h2><div class="skeleton" role="status" aria-label="Nalagam"><span></span><span></span><span></span><span></span></div>';
  const loaded = await loadLinks();
  if (!loaded) return onUnauthorized();
  container.innerHTML = '<h2>Mentor</h2>';
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  if ('error' in loaded) {
    message.textContent = loaded.error;
    container.append(message);
    return;
  }

  const active = loaded.links.find((l) => l.status === 'active');
  const current = panel('Moj mentor');
  if (active) {
    const line = make('p');
    line.append(make('strong', undefined, active.mentor.name));
    current.append(line, confirmButton('Prekini povezavo', 'Potrdi prekinitev', () => void act(active.id, 'end', message, reload, onUnauthorized)));
  } else {
    current.append(make('p', 'hint', 'Nimate aktivnega mentorja.'));
  }

  const invitations = loaded.links.filter((l) => l.status === 'invited');
  const pending = panel('Vabila');
  if (invitations.length === 0) {
    pending.append(make('p', 'hint', 'Ni čakajočih vabil.'));
  } else {
    const table = make('table');
    table.innerHTML = '<thead><tr><th>Mentor</th><th></th></tr></thead>';
    const body = table.createTBody();
    for (const link of invitations) {
      const row = body.insertRow();
      row.insertCell().textContent = link.mentor.name;
      const actions = row.insertCell();
      actions.className = 'actions';
      actions.append(
        button('Sprejmi', () => void act(link.id, 'accept', message, reload, onUnauthorized)),
        button('Zavrni', () => void act(link.id, 'decline', message, reload, onUnauthorized)),
      );
    }
    pending.append(table);
  }
  container.append(message, current, pending);
}
