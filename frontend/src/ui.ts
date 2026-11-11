import { errorMessage, putJson } from './api';
import { icon } from './icons';

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

// Gumb z dvostopenjsko potrditvijo: prvi klik pokaže »Potrdi« in »Prekliči«, šele drugi izvede dejanje.
export function confirmButton(label: string, confirmLabel: string, run: () => void): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'actions';
  const show = () => holder.replaceChildren(button(label, ask));
  const ask = () => holder.replaceChildren(button(confirmLabel, run), button('Prekliči', show));
  show();
  return holder;
}

export type Visibility = 'private' | 'shared';
export const VISIBILITY_LABELS: Record<Visibility, string> = { private: 'Zasebna', shared: 'Deljena' };

// Preklop vidnosti strategije ali testa (US-10): »Deli« oziroma »Prekliči deljenje«, vedno s potrditvijo.
// `path` je pot do vidnosti (npr. /api/strategies/3/visibility); ob uspehu se pokliče `reload`, ob napaki `fail`.
export function visibilityControl(path: string, current: Visibility, reload: () => void, fail: (message: string) => void, onUnauthorized: () => void): HTMLElement {
  const next: Visibility = current === 'private' ? 'shared' : 'private';
  const label = next === 'shared' ? 'Deli' : 'Prekliči deljenje';
  const confirm = next === 'shared' ? 'Potrdi deljenje' : 'Potrdi prekinitev deljenja';
  const report = (message: string) => {
    fail(message);
    toast(message);
  };
  return confirmButton(label, confirm, async () => {
    fail('');
    try {
      const { status, data } = await putJson(path, { visibility: next });
      if (status === 401) return onUnauthorized();
      if (status === 200) return reload();
      report(errorMessage(data, 'Vidnosti ni bilo mogoče spremeniti.'));
      if (status === 404 || status === 403) setTimeout(reload, 2500); // stanje se je medtem spremenilo
    } catch {
      report('Strežnik ni dosegljiv, poskusite znova.');
    }
  });
}

// Toast za napake in obvestila: samodejno izgine, bralnik zaslona ga prebere (role alert/status).
export function toast(message: string, kind: 'error' | 'success' | 'info' = 'error'): void {
  if (!message) return;
  let box = document.querySelector<HTMLElement>('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    document.body.append(box);
  }
  if ([...box.querySelectorAll('.toast span')].some((s) => s.textContent === message)) return; // brez podvojenih
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.insertAdjacentHTML('beforeend', icon(kind === 'error' ? 'alert' : 'check'));
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Zapri obvestilo');
  close.innerHTML = icon('x');
  close.addEventListener('click', () => node.remove());
  node.append(text, close);
  box.append(node);
  setTimeout(() => node.remove(), 6000);
}

// Skeleton namesto besedila »Nalagam ...«.
export function skeleton(): HTMLElement {
  const node = document.createElement('div');
  node.className = 'skeleton';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-label', 'Nalagam');
  node.innerHTML = '<span></span><span></span><span></span><span></span>';
  return node;
}

// Prazno stanje: ikona, naslov, kratko pojasnilo in po želji akcija.
export function emptyState(title: string, text?: string, action?: HTMLElement): HTMLElement {
  const node = document.createElement('div');
  node.className = 'empty';
  node.insertAdjacentHTML('beforeend', icon('inbox'));
  const heading = document.createElement('p');
  heading.className = 'empty-title';
  heading.textContent = title;
  node.append(heading);
  if (text) {
    const detail = document.createElement('p');
    detail.textContent = text;
    node.append(detail);
  }
  if (action) node.append(action);
  return node;
}
