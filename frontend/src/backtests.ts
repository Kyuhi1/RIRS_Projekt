import { loadReference } from './refdata';
import { renderNewTest } from './newTest';

// Stran Backtests (WF-02): levo obrazec za nov test, desno seznam zagonov (sledi).
export async function renderBacktests(container: HTMLElement, _arg: string | undefined, onUnauthorized: () => void): Promise<void> {
  container.innerHTML = '<p>Nalagam ...</p>';
  const ref = await loadReference();
  if (!ref) return onUnauthorized();

  container.innerHTML = '<div class="split"><section id="new-test-panel"></section><section id="runs-panel"></section></div>';
  renderNewTest(container.querySelector<HTMLElement>('#new-test-panel')!, ref);
}
