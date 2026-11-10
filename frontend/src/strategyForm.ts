import { errorMessage, getJson, patchJson, postJson } from './api';

const MAX_FILE_BYTES = 100 * 1024;
const EXTENSIONS = ['.js', '.mjs'];

interface StrategyDetail {
  id: number;
  name: string;
  description: string;
  default_params: Record<string, unknown>;
  mine: boolean;
}

// Sporočilo, ki ga prikaže seznam strategij po uspešnem shranjevanju.
export let flash = '';
export const clearFlash = () => (flash = '');

// Obrazec za novo ali obstoječo strategijo (US-04). Ime, opis in privzete parametre preveri backend,
// datoteko pred pošiljanjem še brskalnik (končnica, velikost), da je razlog viden takoj.
// Brez id-ja ustvari novo strategijo, z id-jem ureja lastno (datoteka je tedaj neobvezna).
export async function renderStrategyForm(container: HTMLElement, id: string | null, onUnauthorized: () => void): Promise<void> {
  let existing: StrategyDetail | null = null;
  if (id !== null) {
    container.innerHTML = '<p>Nalagam ...</p>';
    const { status, data } = await getJson(`/api/strategies/${encodeURIComponent(id)}`);
    if (status === 401) return onUnauthorized();
    if (status !== 200) {
      container.innerHTML = '<p><a href="#strategije">← Nazaj na Strategije</a></p><p class="error"></p>';
      container.querySelector('.error')!.textContent = errorMessage(data, 'Strategije ni mogoče naložiti.');
      return;
    }
    existing = data as StrategyDetail;
  }

  container.innerHTML = `
    <p><a href="#strategije">← Nazaj na Strategije</a></p>
    <h2></h2>
    <form id="strategy-form" class="narrow" novalidate>
      <label for="s-name">Ime (3–80 znakov)</label>
      <input id="s-name" name="name" maxlength="200" />
      <span class="error" data-error="name"></span>

      <label for="s-description">Opis (neobvezno)</label>
      <textarea id="s-description" name="description" rows="3"></textarea>
      <span class="error" data-error="description"></span>

      <label for="s-file">Datoteka strategije (.js, največ 100 KB)</label>
      <input id="s-file" name="file" type="file" accept=".js,.mjs" />
      <p class="hint" id="file-hint"></p>
      <span class="error" data-error="source"></span>

      <label for="s-params">Privzeti parametri (neobvezno, JSON)</label>
      <textarea id="s-params" name="default_params" rows="4" spellcheck="false" placeholder='{"fast": 10, "slow": 30}'></textarea>
      <p class="hint">Objekt s števili, besedilom ali true/false. Pri novem testu jih lahko spremenite za ta test.</p>
      <span class="error" data-error="default_params"></span>

      <button type="submit" id="s-save"></button>
      <span class="error" role="alert" data-error="form"></span>
    </form>`;

  const $ = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  $('h2').textContent = existing ? `Uredi strategijo #${existing.id}` : 'Nova strategija';
  const save = $<HTMLButtonElement>('#s-save');
  save.textContent = existing ? 'Shrani spremembe' : 'Naloži strategijo';
  $('#file-hint').textContent = existing ? 'Pustite prazno, če želite obdržati trenutno datoteko.' : 'Datoteka mora vsebovati »export default (bars, params) => trades«.';
  if (existing) {
    $<HTMLInputElement>('#s-name').value = existing.name;
    $<HTMLTextAreaElement>('#s-description').value = existing.description;
    $<HTMLTextAreaElement>('#s-params').value = Object.keys(existing.default_params).length ? JSON.stringify(existing.default_params, null, 2) : '';
  }

  const form = $<HTMLFormElement>('#strategy-form');
  const showErrors = (errors: Record<string, string>) =>
    form.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = errors[el.dataset.error!] ?? ''));

  // Preveri izbrano datoteko in vrne njeno besedilo (ali null, če datoteke ni); napako vrže kot Error z razlogom.
  async function readFile(): Promise<string | null> {
    const file = $<HTMLInputElement>('#s-file').files?.[0];
    if (!file) return null;
    if (!EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) throw new Error('Datoteka ni v podprtem formatu: izberite datoteko .js ali .mjs');
    if (file.size > MAX_FILE_BYTES) throw new Error(`Datoteka je prevelika (${Math.round(file.size / 1024)} KB), dovoljenih je največ 100 KB`);
    return file.text();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showErrors({});
    let source: string | null;
    try {
      source = await readFile();
    } catch (err) {
      return showErrors({ source: (err as Error).message });
    }

    const body: Record<string, unknown> = {
      name: $<HTMLInputElement>('#s-name').value,
      description: $<HTMLTextAreaElement>('#s-description').value,
      default_params: $<HTMLTextAreaElement>('#s-params').value,
    };
    if (source !== null) body.source = source;

    save.disabled = true;
    try {
      const { status, data } = existing ? await patchJson(`/api/strategies/${existing.id}`, body) : await postJson('/api/strategies', body);
      if (status === 401) return onUnauthorized();
      if (status === 200 || status === 201) {
        flash = existing ? 'Spremembe so shranjene.' : 'Strategija je naložena in na voljo pri novem testu.';
        location.hash = 'strategije';
      } else if (status === 400 && data && typeof data === 'object' && 'errors' in data) showErrors(data.errors as Record<string, string>);
      else showErrors({ form: errorMessage(data, 'Strategije ni bilo mogoče shraniti, poskusite znova.') });
    } catch {
      showErrors({ form: 'Strežnik ni dosegljiv, poskusite znova.' });
    } finally {
      save.disabled = false;
    }
  });
}
