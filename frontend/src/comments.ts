import { errorMessage, getJson, postJson } from './api';
import { when } from './status';

interface Comment {
  id: number;
  body: string;
  is_mistake: boolean;
  created_at: string;
  author: { id: number; name: string };
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function item(comment: Comment): HTMLElement {
  const box = make('article', comment.is_mistake ? 'comment mistake' : 'comment');
  const head = make('div', 'hint');
  if (comment.is_mistake) head.append(make('span', 'badge mistake-badge', 'Napaka'), ' ');
  head.append(`${comment.author.name} · ${when(comment.created_at)}`);
  box.append(head, make('p', 'comment-body', comment.body));
  return box;
}

// Komentarji testa (US-14, WF-05): zabeležene napake so ločene od običajnih komentarjev in označene z rdečo.
// Mentor med pregledom (in_review) vidi obrazec za nov komentar; trgovec komentarje samo bere.
export async function renderComments(box: HTMLElement, testId: number, status: string, role: 'trader' | 'mentor', reload: () => void, onUnauthorized: () => void): Promise<void> {
  const { status: code, data } = await getJson(`/api/backtests/${testId}/comments`);
  if (code === 401) return onUnauthorized();
  if (code !== 200) {
    box.replaceChildren(make('p', 'error', errorMessage(data, 'Komentarjev ni mogoče naložiti.')));
    return;
  }
  const comments = data as Comment[];
  const mistakes = comments.filter((c) => c.is_mistake);
  const regular = comments.filter((c) => !c.is_mistake);

  box.replaceChildren();
  if (comments.length === 0) box.append(make('p', 'hint', 'Ni komentarjev.'));
  if (mistakes.length > 0) {
    const group = make('div', 'comment-group');
    group.dataset.group = 'mistakes';
    group.append(make('h4', 'mistake-title', `Zabeležene napake (${mistakes.length})`), ...mistakes.map(item));
    box.append(group);
  }
  if (regular.length > 0) {
    const group = make('div', 'comment-group');
    group.dataset.group = 'comments';
    group.append(make('h4', undefined, `Komentarji (${regular.length})`), ...regular.map(item));
    box.append(group);
  }

  if (role !== 'mentor') return;
  if (status !== 'in_review') {
    box.append(make('p', 'hint', status === 'submitted' ? 'Komentiranje je mogoče, ko začnete pregled.' : 'Komentarji so zaklenjeni.'));
    return;
  }
  const form = make('form');
  form.noValidate = true;
  form.innerHTML = `
    <label for="comment-body">Nov komentar</label>
    <textarea id="comment-body" name="body" rows="4"></textarea>
    <span class="error" data-error="body"></span>
    <label class="inline"><input id="comment-mistake" type="checkbox" /> Označi kot napako</label>
    <button type="submit">Dodaj komentar</button>`;
  const error = form.querySelector<HTMLElement>('[data-error="body"]')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const submit = form.querySelector<HTMLButtonElement>('button')!;
    submit.disabled = true;
    try {
      const { status: result, data: reply } = await postJson(`/api/backtests/${testId}/comments`, {
        body: form.querySelector<HTMLTextAreaElement>('#comment-body')!.value,
        is_mistake: form.querySelector<HTMLInputElement>('#comment-mistake')!.checked,
      });
      if (result === 401) return onUnauthorized();
      if (result === 201) return reload();
      const errors = reply && typeof reply === 'object' && 'errors' in reply ? (reply.errors as Record<string, string>) : {};
      error.textContent = errors.body ?? errors.is_mistake ?? errorMessage(reply, 'Komentarja ni bilo mogoče dodati.');
      if (result === 409 || result === 404) setTimeout(reload, 2500); // stanje se je medtem spremenilo
    } catch {
      error.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
    } finally {
      submit.disabled = false;
    }
  });
  box.append(form);
}
