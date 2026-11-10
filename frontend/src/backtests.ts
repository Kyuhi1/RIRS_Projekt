import { errorMessage, getJson } from './api';
import { renderNewTest } from './newTest';
import { loadReference } from './refdata';

interface BacktestDetail {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  status: string;
}

// Stran rezultatov testa (WF-03). Polna vsebina sledi v naslednji nalogi; zaenkrat osnovni podatki testa.
async function renderResult(container: HTMLElement, id: string, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = '<p>Nalagam ...</p>';
  const { status, data } = await getJson(`/api/backtests/${encodeURIComponent(id)}`);
  if (status === 401) return onUnauthorized();
  container.innerHTML = '<p><a href="#backtests">← Nazaj na Backtests</a></p><h2>Rezultati testa</h2><div id="result"></div>';
  const box = container.querySelector<HTMLElement>('#result')!;
  if (status !== 200) {
    box.className = 'error';
    box.textContent = errorMessage(data, 'Testa ni mogoče naložiti.');
    return;
  }
  const t = data as BacktestDetail;
  box.textContent = `Test #${t.id}: ${t.strategy_name}, ${t.instruments.join(', ')}, ${t.from} do ${t.to}, stanje ${t.status}.`;
}

// Stran Backtests (WF-02): levo obrazec za nov test, desno seznam zagonov (sledi).
export async function renderBacktests(container: HTMLElement, arg: string | undefined, onUnauthorized: () => void): Promise<void> {
  if (arg) return renderResult(container, arg, onUnauthorized);

  container.innerHTML = '<p>Nalagam ...</p>';
  const ref = await loadReference();
  if (!ref) return onUnauthorized();

  container.innerHTML = '<div class="split"><section id="new-test-panel"></section><section id="runs-panel"></section></div>';
  renderNewTest(container.querySelector<HTMLElement>('#new-test-panel')!, ref, (id) => {
    location.hash = `backtests/${id}`; // po uspešnem zagonu se odpre stran rezultatov
  });
}
