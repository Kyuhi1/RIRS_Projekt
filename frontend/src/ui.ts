import { errorMessage, putJson } from './api';

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
  return confirmButton(label, confirm, async () => {
    fail('');
    try {
      const { status, data } = await putJson(path, { visibility: next });
      if (status === 401) return onUnauthorized();
      if (status === 200) return reload();
      fail(errorMessage(data, 'Vidnosti ni bilo mogoče spremeniti.'));
      if (status === 404 || status === 403) setTimeout(reload, 2500); // stanje se je medtem spremenilo
    } catch {
      fail('Strežnik ni dosegljiv, poskusite znova.');
    }
  });
}
