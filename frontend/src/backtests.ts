import { renderNewTest } from './newTest';
import { loadReference } from './refdata';
import { renderResult } from './result';
import { renderRuns } from './runs';

// Stran Backtests (WF-02): levo obrazec za nov test, desno seznam zagonov.
export async function renderBacktests(container: HTMLElement, arg: string | undefined, onUnauthorized: () => void): Promise<void> {
  if (arg) return renderResult(container, arg, onUnauthorized);

  container.innerHTML = '<p>Nalagam ...</p>';
  const ref = await loadReference();
  if (!ref) return onUnauthorized();

  container.innerHTML = '<div class="split"><section id="new-test-panel"></section><section id="runs-panel"></section></div>';
  renderNewTest(container.querySelector<HTMLElement>('#new-test-panel')!, ref, (id) => {
    location.hash = `backtests/${id}`; // po uspešnem zagonu se odpre stran rezultatov
  });
  await renderRuns(container.querySelector<HTMLElement>('#runs-panel')!, ref, onUnauthorized);
}
