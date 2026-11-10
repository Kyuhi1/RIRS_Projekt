import { errorMessage, getJson, postJson } from './api';
import { ASSET_CLASS_LABELS, type Reference } from './refdata';

const DAY_MS = 86_400_000;
const day = (iso: string) => iso.slice(0, 10);
const percent = (fraction: number) => `${+(fraction * 100).toFixed(4)} %`;

interface StrategyDetail {
  default_params: Record<string, unknown>;
}

// Razpon podatkov, ki ga imajo vsa izbrana sredstva (po dnevih, UTC); null, če ni skupnega razpona.
export function commonRange(ref: Reference, tickers: string[]): { from: string; to: string } | null {
  let from = '';
  let to = '9999-99-99';
  for (const ticker of tickers) {
    const i = ref.instruments.find((x) => x.ticker === ticker);
    if (!i?.data_from || !i.data_to) return null;
    from = day(i.data_from) > from ? day(i.data_from) : from;
    to = day(i.data_to) < to ? day(i.data_to) : to;
  }
  return from && from <= to ? { from, to } : null;
}

// Začetek obdobja »zadnjih n let« glede na konec podatkov, omejen na začetek podatkov.
export function yearsBack(range: { from: string; to: string }, years: number): string {
  const end = new Date(`${range.to}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() - years);
  end.setTime(end.getTime() + DAY_MS); // zadnjih n let vključuje zadnji dan podatkov
  const from = end.toISOString().slice(0, 10);
  return from > range.from ? from : range.from;
}

// »de-DE« ima enaka ločila kot slovenščina, a pika tudi pri štirimestnih številih (sl-SI jo izpusti: 5000).
const amount = (value: number) => value.toLocaleString('de-DE');

const options = (items: { value: string; label: string }[], placeholder: string) =>
  `<option value="">${placeholder}</option>` + items.map((i) => `<option value="${i.value}"></option>`).join('');

function fillOptions(select: HTMLSelectElement, items: { value: string; label: string }[], placeholder: string): void {
  select.innerHTML = options(items, placeholder);
  items.forEach((item, i) => (select.options[i + 1]!.textContent = item.label));
}

// Spremenjene vrednosti parametrov (samo tiste, ki se razlikujejo od privzetih) ali napaka ob polju.
function collectParams(container: HTMLElement): { params: Record<string, unknown> } | { error: string } {
  const params: Record<string, unknown> = {};
  for (const input of container.querySelectorAll<HTMLInputElement>('[data-param]')) {
    const key = input.dataset.param!;
    const original = JSON.parse(input.dataset.default!) as unknown;
    let value: unknown;
    if (typeof original === 'boolean') value = input.checked;
    else if (typeof original === 'number') {
      value = input.value.trim() === '' ? NaN : Number(input.value);
      if (!Number.isFinite(value as number)) return { error: `Parameter ${key} mora biti število` };
    } else if (typeof original === 'string') value = input.value;
    else {
      try {
        value = JSON.parse(input.value);
      } catch {
        return { error: `Parameter ${key} mora biti veljaven JSON` };
      }
    }
    if (JSON.stringify(value) !== JSON.stringify(original)) params[key] = value;
  }
  return { params };
}

// Obrazec »Nov test« (WF-02): strategija, sredstva, obdobje, borza, financiran račun, nastavitve strategije.
// Ob uspešnem zagonu pokliče onCreated z id-jem shranjenega testa.
export function renderNewTest(container: HTMLElement, ref: Reference, onCreated: (id: number) => void): void {
  container.innerHTML = `
    <h2>Nov test</h2>
    <form id="new-test" novalidate>
      <label for="strategy">Strategija</label>
      <select id="strategy" name="strategy_id"></select>
      <p class="hint"><a href="#strategije/nova">Naloži lastno strategijo</a></p>
      <span class="error" data-error="strategy_id"></span>

      <fieldset class="instruments">
        <legend>Sredstvo (eno ali več)</legend>
        <div id="instruments"></div>
      </fieldset>
      <span class="error" data-error="instruments"></span>

      <div class="dates">
        <div><label for="from">Od</label><input id="from" name="from" type="date" /><span class="error" data-error="from"></span></div>
        <div><label for="to">Do</label><input id="to" name="to" type="date" /><span class="error" data-error="to"></span></div>
      </div>
      <div class="presets" role="group" aria-label="Prednastavitve obdobja">
        <button type="button" data-preset="all">Celotna zgodovina</button>
        <button type="button" data-preset="1">Zadnje leto</button>
        <button type="button" data-preset="3">Zadnja 3 leta</button>
        <button type="button" data-preset="5">Zadnjih 5 let</button>
      </div>
      <p class="hint" id="range-hint"></p>
      <span class="error" data-error="period"></span>

      <label for="venue">Borza</label>
      <select id="venue" name="venue_id"></select>
      <p class="hint" id="venue-info"></p>
      <span class="error" data-error="venue_id"></span>

      <label for="prop-plan">Financiran račun (neobvezno)</label>
      <select id="prop-plan" name="prop_plan_id"></select>
      <p class="hint" id="plan-info">Brez izbire se pravila ne preverjajo in test teče s kapitalom 10.000.</p>
      <span class="error" data-error="prop_plan_id"></span>

      <fieldset class="params">
        <legend>Nastavitve strategije</legend>
        <p class="hint" id="params-hint">Izberite strategijo.</p>
        <div id="params"></div>
      </fieldset>
      <span class="error" data-error="params"></span>

      <button type="submit" id="run">Zaženi test</button>
      <span class="error" role="alert" data-error="form"></span>
    </form>`;

  const $ = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const strategy = $<HTMLSelectElement>('#strategy');
  const venue = $<HTMLSelectElement>('#venue');
  const hint = $('#range-hint');

  fillOptions(strategy, ref.strategies.map((s) => ({ value: String(s.id), label: `${s.name} (${s.author})` })), 'Izberite strategijo');
  fillOptions(venue, ref.venues.map((v) => ({ value: v.id, label: v.name })), 'Izberite borzo');
  fillOptions($('#prop-plan'), ref.propPlans.map((p) => ({ value: p.id, label: `${p.firm_name} – ${p.plan_name}` })), 'Brez financiranega računa');

  // Sredstva po skupinah; sredstva brez zgodovinskih podatkov so onemogočena.
  const list = $('#instruments');
  for (const [assetClass, label] of Object.entries(ASSET_CLASS_LABELS)) {
    const group = ref.instruments.filter((i) => i.asset_class === assetClass);
    if (group.length === 0) continue;
    const heading = document.createElement('strong');
    heading.textContent = label;
    list.append(heading);
    for (const i of group) {
      const row = document.createElement('label');
      row.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'instruments';
      box.value = i.ticker;
      box.disabled = !i.data_from;
      row.append(box, ` ${i.ticker} – ${i.description}${i.data_from ? ` (${day(i.data_from)} do ${day(i.data_to!)})` : ' (ni podatkov)'}`);
      list.append(row);
    }
  }
  const selected = () => [...container.querySelectorAll<HTMLInputElement>('input[name=instruments]:checked')].map((b) => b.value);

  const showRange = () => {
    const tickers = selected();
    const range = commonRange(ref, tickers);
    hint.textContent = tickers.length === 0 ? '' : range ? `Razpoložljivi podatki: ${range.from} do ${range.to}` : 'Izbrana sredstva nimajo skupnega razpona podatkov.';
  };
  list.addEventListener('change', showRange);

  // Prednastavitve obdobja glede na skupni razpon izbranih sredstev.
  container.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      const range = commonRange(ref, selected());
      if (!range) {
        hint.textContent = selected().length === 0 ? 'Najprej izberite sredstvo.' : 'Izbrana sredstva nimajo skupnega razpona podatkov.';
        return;
      }
      const preset = button.dataset.preset!;
      $<HTMLInputElement>('#from').value = preset === 'all' ? range.from : yearsBack(range, Number(preset));
      $<HTMLInputElement>('#to').value = range.to;
    }),
  );

  // Izbira načrta pokaže njegova pravila; test teče s kapitalom računa.
  const plan = $<HTMLSelectElement>('#prop-plan');
  plan.addEventListener('change', () => {
    const p = ref.propPlans.find((x) => x.id === plan.value);
    $('#plan-info').textContent = p
      ? `Račun ${amount(p.account_size)}, cilj dobička ${amount(p.profit_target)}, največja dnevna izguba ${amount(p.max_daily_loss)}, največja skupna izguba ${amount(p.max_total_loss)}. Test teče s kapitalom računa.`
      : 'Brez izbire se pravila ne preverjajo in test teče s kapitalom 10.000.';
  });

  venue.addEventListener('change', () => {
    const v = ref.venues.find((x) => x.id === venue.value);
    $('#venue-info').textContent = v
      ? `Provizija maker ${percent(v.maker_pct)}, taker ${percent(v.taker_pct)}; razpon (spread): ${v.pay_spread ? 'se plača' : 'se ne plača'}`
      : '';
  });

  // Nastavitve strategije: za vsak privzeti parameter eno polje; spremembe veljajo samo za ta test.
  const paramsBox = $('#params');
  strategy.addEventListener('change', async () => {
    paramsBox.innerHTML = '';
    const hintEl = $('#params-hint');
    if (!strategy.value) {
      hintEl.textContent = 'Izberite strategijo.';
      return;
    }
    hintEl.textContent = 'Nalagam ...';
    try {
      const { status, data } = await getJson(`/api/strategies/${strategy.value}`);
      if (status !== 200) throw new Error(errorMessage(data, 'Parametrov ni mogoče naložiti'));
      const defaults = (data as StrategyDetail).default_params;
      const keys = Object.keys(defaults);
      hintEl.textContent = keys.length ? 'Spremembe veljajo samo za ta test.' : 'Strategija nima parametrov.';
      for (const key of keys) {
        const value = defaults[key];
        const row = document.createElement('label');
        row.append(`${key} `);
        const input = document.createElement('input');
        input.name = key;
        input.dataset.param = key;
        input.dataset.default = JSON.stringify(value);
        if (typeof value === 'boolean') {
          input.type = 'checkbox';
          input.checked = value;
        } else {
          input.type = typeof value === 'number' ? 'number' : 'text';
          input.step = 'any';
          input.value = typeof value === 'string' ? value : JSON.stringify(value);
        }
        row.append(input);
        paramsBox.append(row);
      }
    } catch (err) {
      hintEl.textContent = err instanceof Error ? err.message : 'Parametrov ni mogoče naložiti';
    }
  });

  // Zagon testa: validacijo opravi backend, napake prikažemo ob poljih (brez notranjih podrobnosti strežnika).
  const form = $<HTMLFormElement>('#new-test');
  const button = $<HTMLButtonElement>('#run');
  const showErrors = (errors: Record<string, string>) =>
    form.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = errors[el.dataset.error!] ?? ''));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showErrors({});
    const collected = collectParams(container);
    if ('error' in collected) return showErrors({ params: collected.error });

    button.disabled = true;
    button.textContent = 'Izvajam test ...';
    try {
      const { status, data } = await postJson('/api/backtests', {
        strategy_id: strategy.value ? Number(strategy.value) : undefined,
        instruments: selected(),
        venue_id: venue.value,
        from: $<HTMLInputElement>('#from').value,
        to: $<HTMLInputElement>('#to').value,
        params: collected.params,
        prop_plan_id: plan.value || undefined,
      });
      if (status === 201) onCreated((data as { id: number }).id);
      else if (status === 400 && data && typeof data === 'object' && 'errors' in data) showErrors(data.errors as Record<string, string>);
      else showErrors({ form: errorMessage(data, 'Testa ni bilo mogoče izvesti, poskusite znova.') });
    } catch {
      showErrors({ form: 'Strežnik ni dosegljiv, poskusite znova.' });
    } finally {
      button.disabled = false;
      button.textContent = 'Zaženi test';
    }
  });
}
