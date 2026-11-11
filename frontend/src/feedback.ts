import { errorMessage, postJson } from './api';
import { renderComments } from './comments';
import { statusLabel } from './status';

export interface FeedbackState {
  id: number;
  status: string;
  next_id: number | null;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Panel »Mentorjev odziv« (US-12): trenutno stanje, mentorjevi komentarji samo za branje (napake rdeče) in
// ob zahtevanih spremembah »Ponovi test«, ki ustvari nov osnutek z istimi nastavitvami in ga odpre.
export async function renderFeedback(box: HTMLElement, test: FeedbackState, reload: () => void, onUnauthorized: () => void): Promise<void> {
  const state = make('p', undefined);
  state.append('Stanje: ', make('strong', undefined, statusLabel(test.status)));
  state.dataset.state = '';
  const message = make('p', 'error');
  message.setAttribute('role', 'alert');
  const actions = make('div', 'review-actions');

  if (test.status === 'changes_requested') {
    if (test.next_id !== null) {
      const link = make('a', undefined, `Ponovitev testa #${test.next_id}`);
      link.href = `#backtests/${test.next_id}`;
      actions.append(link);
    } else {
      const retest = make('button', undefined, 'Ponovi test');
      retest.type = 'button';
      retest.addEventListener('click', async () => {
        message.textContent = '';
        retest.disabled = true;
        try {
          const { status, data } = await postJson(`/api/backtests/${test.id}/retest`);
          if (status === 401) return onUnauthorized();
          if (status === 201) {
            location.hash = `backtests/${(data as { id: number }).id}`; // odpre se nov osnutek
            return;
          }
          message.textContent = errorMessage(data, 'Testa ni mogoče ponoviti.');
          if (status === 409 || status === 404) setTimeout(reload, 2500); // stanje se je medtem spremenilo
          else retest.disabled = false;
        } catch {
          message.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
          retest.disabled = false;
        }
      });
      actions.append(retest, make('p', 'hint', 'Ustvari nov osnutek z istimi nastavitvami, ki ga lahko ponovno oddaš mentorju.'));
    }
  }

  const comments = make('div');
  box.replaceChildren(state, actions, message, comments);
  await renderComments(comments, test.id, test.status, 'trader', reload, onUnauthorized);
}
