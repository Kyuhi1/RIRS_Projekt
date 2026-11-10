import { deleteJson, errorMessage, getJson } from './api';
import { clearFlash, flash, renderStrategyForm } from './strategyForm';

interface Strategy {
  id: number;
  name: string;
  description: string;
  author: string; // »Sistem« pri sistemskih strategijah
  visibility: 'private' | 'shared';
  mine: boolean;
}

const VISIBILITY_LABELS = { private: 'Zasebna', shared: 'Deljena' };

const cell = (text: string) => {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
};

// Seznam strategij (sistemske, lastne in deljene). Lastne imajo dejanji Uredi in Izbriši; brisanje zahteva potrditev.
async function renderList(container: HTMLElement, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = '<h2>Strategije</h2><p><a class="button" href="#strategije/nova">Nova strategija</a></p><p class="success" id="flash" role="status"></p><div id="list"><p>Nalagam ...</p></div>';
  container.querySelector('#flash')!.textContent = flash;
  clearFlash();
  const list = container.querySelector<HTMLElement>('#list')!;

  const { status, data } = await getJson('/api/strategies');
  if (status === 401) return onUnauthorized();
  if (status !== 200) {
    list.innerHTML = '<p class="error"></p>';
    list.querySelector('.error')!.textContent = errorMessage(data, 'Strategij ni mogoče naložiti.');
    return;
  }
  const strategies = data as Strategy[];
  if (strategies.length === 0) {
    list.innerHTML = '<p>Ni strategij</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Ime</th><th>Opis</th><th>Avtor</th><th>Vidnost</th><th></th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody')!;
  const message = document.createElement('p');
  message.className = 'error';
  message.setAttribute('role', 'alert');

  for (const s of strategies) {
    const row = document.createElement('tr');
    const actions = document.createElement('td');
    actions.className = 'actions';
    if (s.mine) {
      const edit = document.createElement('a');
      edit.href = `#strategije/${s.id}`;
      edit.textContent = 'Uredi';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Izbriši';
      remove.addEventListener('click', () => confirmDelete(actions, s, message, () => void renderList(container, onUnauthorized), onUnauthorized));
      actions.append(edit, remove);
    }
    row.append(cell(s.name), cell(s.description), cell(s.author), cell(VISIBILITY_LABELS[s.visibility]), actions);
    body.append(row);
  }
  list.replaceChildren(message, table);
}

// Namesto »Izbriši« se pokažeta »Potrdi« in »Prekliči«; napaka (npr. strategija ima teste) se prikaže nad tabelo.
function confirmDelete(actions: HTMLElement, s: Strategy, message: HTMLElement, reload: () => void, onUnauthorized: () => void): void {
  message.textContent = '';
  const original = [...actions.childNodes];
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = `Potrdi brisanje »${s.name}«`;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Prekliči';
  cancel.addEventListener('click', () => actions.replaceChildren(...original));
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const { status, data } = await deleteJson(`/api/strategies/${s.id}`);
      if (status === 401) return onUnauthorized();
      if (status === 200) return reload();
      message.textContent = errorMessage(data, 'Strategije ni bilo mogoče izbrisati.');
    } catch {
      message.textContent = 'Strežnik ni dosegljiv, poskusite znova.';
    }
    actions.replaceChildren(...original);
  });
  actions.replaceChildren(confirm, cancel);
}

// Stran Strategije: `#strategije` seznam, `#strategije/nova` nalaganje, `#strategije/<id>` urejanje.
export async function renderStrategies(container: HTMLElement, arg: string | undefined, onUnauthorized: () => void): Promise<void> {
  if (arg === 'nova') return renderStrategyForm(container, null, onUnauthorized);
  if (arg) return renderStrategyForm(container, arg, onUnauthorized);
  return renderList(container, onUnauthorized);
}
