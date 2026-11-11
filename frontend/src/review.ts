import { errorMessage, getJson, postJson } from './api';
import { statusLabel } from './status';

export interface HistoryEntry {
  from_status: string;
  to_status: string;
  changed_at: string;
  changed_by: { id: number; name: string };
}
export interface ReviewState {
  id: number;
  status: string;
  reviewer: { id: number; name: string } | null;
  history: HistoryEntry[];
}

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

// Umik oddaje je dvostopenjski: prvi klik pokaže »Potrdi« in »Prekliči«.
function confirmButton(label: string, confirmLabel: string, run: () => void): HTMLElement {
  const holder = make('span', 'actions');
  const show = () => holder.replaceChildren(button(label, ask));
  const ask = () => holder.replaceChildren(button(confirmLabel, run), button('Prekliči', show));
  show();
  return holder;
}

const when = (iso: string) => new Date(iso).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' });

// Ali ima trgovec aktivnega mentorja; null pomeni potekla seja (401), false tudi napako pri nalaganju.
async function hasActiveMentor(): Promise<boolean | null> {
  const { status, data } = await getJson('/api/mentor-links');
  if (status === 401) return null;
  return status === 200 && (data as { status: string }[]).some((l) => l.status === 'active');
}

// Razdelek »Mentorski pregled« na strani rezultatov (US-12): oddaja, umik, mentor in zgodovina stanj.
export async function renderReview(box: HTMLElement, test: ReviewState, reload: () => void, onUnauthorized: () => void): Promise<void> {
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  const actions = make('div', 'review-actions');

  const act = async (action: 'submit' | 'withdraw') => {
    message.textContent = '';
    try {
      const { status, data } = await postJson(`/api/backtests/${test.id}/${action}`);
      if (status === 401) return onUnauthorized();
      if (status === 200) return reload();
      message.textContent = errorMessage(data, 'Dejanja ni bilo mogoče izvesti.');
      if (status === 409 || status === 404) setTimeout(reload, 2500); // stanje se je medtem spremenilo
    } catch {
      message.textContent = 'Strežnik ni dosegljiv.';
    }
  };

  if (test.status === 'draft') {
    const active = await hasActiveMentor();
    if (active === null) return onUnauthorized();
    const submit = button('Oddaj mentorju', () => void act('submit'));
    actions.append(submit);
    if (!active) {
      submit.disabled = true;
      const hint = make('p', 'hint', 'Najprej se poveži z mentorjem. ');
      const link = make('a', undefined, 'Odpri stran Mentor');
      link.href = '#mentor';
      hint.append(link);
      actions.append(hint);
    }
  } else if (test.status === 'submitted') {
    actions.append(confirmButton('Umakni oddajo', 'Potrdi umik', () => void act('withdraw')));
  } else if (test.status === 'in_review') {
    actions.append(make('p', 'hint', 'Mentor je pregled začel, oddaje ni več mogoče umakniti.'));
  }

  const facts = make('p', 'hint', test.reviewer ? `Mentor: ${test.reviewer.name}` : 'Test še ni oddan mentorju.');
  facts.dataset.reviewer = '';
  const history = make('ol', 'history');
  for (const h of test.history) {
    history.append(make('li', undefined, `${when(h.changed_at)}: ${statusLabel(h.from_status)} → ${statusLabel(h.to_status)} (${h.changed_by.name})`));
  }
  box.replaceChildren(facts, actions, message, ...(test.history.length ? [make('h4', undefined, 'Zgodovina stanj'), history] : []));
}
