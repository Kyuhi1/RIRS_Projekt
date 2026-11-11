import { errorMessage, getJson } from './api';
import { renderEquityChart, type EquityPoint, type Marker } from './equityChart';
import { renderComments } from './comments';
import { renderFeedback } from './feedback';
import { renderReview, type HistoryEntry } from './review';
import { fetchCurrentUser, type Role } from './session';
import { VISIBILITY_LABELS, visibilityControl } from './ui';
import { statusBadge } from './status';
import { renderTrades } from './trades';

interface Venue {
  id: string;
  name: string;
  maker_pct: number;
  taker_pct: number;
  pay_spread: boolean;
}
interface Rule {
  achieved: number;
  allowed: number;
  passed: boolean;
  firstViolation: string | null;
}
interface Challenge {
  passed: boolean;
  profitTarget: Rule;
  maxDailyLoss: Rule;
  maxTotalLoss: Rule;
}
interface BacktestDetail {
  id: number;
  strategy_name: string;
  venue_id: string;
  instruments: string[];
  from: string;
  to: string;
  params: Record<string, unknown>;
  prop_plan: { id: string; firm_name: string; plan_name: string } | null;
  status: string;
  visibility: 'private' | 'shared';
  previous_id: number | null;
  next_id: number | null;
  reviewer: { id: number; name: string } | null;
  owner: { id: number; name: string };
  history: HistoryEntry[];
  results: {
    initialCapital: number;
    timeframe?: string; // starejši testi ga nimajo (minutne svečke)
    finalCapital: number;
    grossProfit: number;
    costs: { commission: number; spread: number; total: number };
    netProfit: number;
    returnPct: number;
    tradeCount: number;
    winRatePct: number;
    maxDrawdownPct: number;
    equityCurve: EquityPoint[];
    challenge?: Challenge; // samo, če je bil izbran načrt financiranega računa
  };
}

const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const sign = (value: number) => (value >= 0 ? 'pnl-up' : 'pnl-down'); // barva + ikona ▲/▼

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metric(label: string, value: string, className = ''): HTMLElement {
  const box = make('div', 'metric');
  box.append(make('span', 'hint', label), make('strong', className, value));
  return box;
}

function rows(items: [string, string][]): HTMLElement {
  const list = make('dl', 'facts');
  for (const [label, value] of items) list.append(make('dt', undefined, label), make('dd', undefined, value));
  return list;
}

function section(title: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const box = make('section', 'card');
  box.append(make('h3', undefined, title), ...content.map((c) => (typeof c === 'string' ? make('p', 'hint', c) : c)));
  return box;
}

const plain = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Blok »Pravila financiranega računa«: za vsako pravilo dosežen in dovoljen znesek, izid in datum prve kršitve.
function rulesSection(challenge: Challenge): HTMLElement {
  const rows: [string, string, Rule][] = [
    ['Cilj dobička', 'najmanj', challenge.profitTarget],
    ['Največja dnevna izguba', 'največ', challenge.maxDailyLoss],
    ['Največja skupna izguba', 'največ', challenge.maxTotalLoss],
  ];
  const table = make('table', 'rules');
  table.innerHTML = '<thead><tr><th>Pravilo</th><th>Doseženo</th><th>Dovoljeno</th><th>Izid</th><th>Prva kršitev</th></tr></thead>';
  const body = table.createTBody();
  for (const [label, bound, rule] of rows) {
    const row = body.insertRow();
    row.insertCell().textContent = label;
    row.insertCell().textContent = plain(rule.achieved);
    row.insertCell().textContent = `${bound} ${plain(rule.allowed)}`;
    const outcome = row.insertCell();
    outcome.className = rule.passed ? 'positive' : 'negative';
    outcome.textContent = rule.passed ? 'Izpolnjeno' : 'Kršeno';
    row.insertCell().textContent = rule.firstViolation ?? '–';
  }
  const verdict = make('p', challenge.passed ? 'positive' : 'negative');
  verdict.append(make('strong', undefined, challenge.passed ? 'Izziv opravljen: vsa tri pravila so izpolnjena.' : 'Izziv ni opravljen: vsaj eno pravilo ni izpolnjeno.'));
  return section('Pravila financiranega računa', table, verdict);
}

// Stran rezultatov testa (WF-03): glava z nastavitvami, metrike, krivulja, stroški, pravila in posli.
const TIMEFRAME_LABELS: Record<string, string> = { '1m': '1 minuta', '5m': '5 minut', '15m': '15 minut', '30m': '30 minut', '1h': '1 ura', '4h': '4 ure', '1d': '1 dan' };

export async function renderResult(container: HTMLElement, id: string, onUnauthorized: () => void, role: Role = 'trader'): Promise<void> {
  container.innerHTML = '<div class="skeleton" role="status" aria-label="Nalagam"><span></span><span></span><span></span><span></span></div>';
  const [detail, venues, me] = await Promise.all([getJson(`/api/backtests/${encodeURIComponent(id)}`), getJson('/api/venues'), role === 'trader' ? fetchCurrentUser() : Promise.resolve(null)]);
  if (detail.status === 401 || venues.status === 401 || (role === 'trader' && me === null)) return onUnauthorized();

  container.replaceChildren();
  const back = make('p');
  const link = make('a', undefined, role === 'mentor' ? '← Nazaj na nadzorno ploščo' : '← Nazaj na teste');
  link.href = role === 'mentor' ? '#dashboard' : '#backtests';
  back.append(link);
  container.append(back);
  if (detail.status !== 200) {
    container.append(make('p', 'error', errorMessage(detail.data, 'Testa ni mogoče naložiti.')));
    return;
  }

  const t = detail.data as BacktestDetail;
  const foreign = role === 'trader' && t.owner.id !== me!.id; // deljeni test drugega trgovca (samo za branje)
  const r = t.results;
  const venue = venues.status === 200 ? (venues.data as Venue[]).find((v) => v.id === t.venue_id) : undefined;
  const venueName = venue?.name ?? t.venue_id;

  const header = make('header', 'result-head');
  header.append(make('h2', undefined, `Zagon #${t.id}: ${t.strategy_name}`), statusBadge(t.status));
  if (t.previous_id !== null) {
    const origin = make('a', undefined, `Ponovitev testa #${t.previous_id}`);
    origin.href = role === 'mentor' ? `#pregled/${t.previous_id}` : `#backtests/${t.previous_id}`;
    header.append(origin);
  }

  const metrics = make('div', 'metrics');
  metrics.append(
    metric('Neto dobiček', money(r.netProfit), sign(r.netProfit)),
    metric('Donosnost', `${money(r.returnPct)} %`, sign(r.returnPct)),
    metric('Število poslov', String(r.tradeCount)),
    metric('Največji padec', `${r.maxDrawdownPct.toFixed(2)} %`),
    metric('Delež dobičkonosnih', `${r.winRatePct.toFixed(1)} %`),
    metric('Skupni stroški', r.costs.total.toFixed(2)),
  );

  const params = Object.entries(t.params);
  const settings = section(
    'Nastavitve testa',
    rows([
      ['Strategija', t.strategy_name],
      ['Parametri', params.length ? params.map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'brez parametrov'],
      ['Sredstva', t.instruments.join(', ')],
      ['Borza', venueName],
      ['Obdobje', `${t.from} do ${t.to}`],
      ['Časovni okvir', TIMEFRAME_LABELS[r.timeframe ?? '1m'] ?? r.timeframe ?? '1 minuta'],
      ['Začetni kapital', r.initialCapital.toFixed(2)],
      ['Financiran račun', t.prop_plan ? `${t.prop_plan.firm_name} – ${t.prop_plan.plan_name}` : 'ni izbran'],
    ]),
  );

  const chartBox = make('div');
  const chart = section('Krivulja vrednosti računa', chartBox);
  const markers: Marker[] = [];
  if (r.challenge?.maxDailyLoss.firstViolation) markers.push({ date: r.challenge.maxDailyLoss.firstViolation, label: 'dnevna izguba' });
  if (r.challenge?.maxTotalLoss.firstViolation) markers.push({ date: r.challenge.maxTotalLoss.firstViolation, label: 'skupna izguba' });
  renderEquityChart(chartBox, r.equityCurve, r.initialCapital, markers);

  const costs = section(
    'Stroški borze',
    rows([
      ['Bruto dobiček', money(r.grossProfit)],
      ['Provizije', r.costs.commission.toFixed(2)],
      ['Razpon', r.costs.spread.toFixed(2)],
      ['Neto dobiček', money(r.netProfit)],
    ]),
  );

  const tradesBox = make('div');
  const trades = section('Posli', tradesBox);

  // Brez načrta razdelka s pravili ni; stroški zasedejo celotno širino.
  const cards = make('div', r.challenge ? 'cards-two' : '');
  cards.append(costs);
  if (r.challenge) cards.append(rulesSection(r.challenge));
  const reload = () => void renderResult(container, id, onUnauthorized, role);
  const reviewBox = make('div');
  const commentsBox = make('div');
  const pending = [renderTrades(tradesBox, t.id, onUnauthorized)];

  if (role === 'mentor') {
    // WF-05: levo rezultati samo za branje, desno komentarji, odločitev in zgodovina stanj.
    const lock = make('p', 'readonly-note', 'Samo za branje: parametrov in rezultatov testa ni mogoče spreminjati.');
    const mentorMetrics = make('div', 'metrics');
    mentorMetrics.append(
      metric('Neto dobiček', money(r.netProfit), sign(r.netProfit)),
      metric('Donosnost', `${money(r.returnPct)} %`, sign(r.returnPct)),
      metric('Največji padec', `${r.maxDrawdownPct.toFixed(2)} %`),
      metric('Delež dobičkonosnih', `${r.winRatePct.toFixed(1)} %`),
    );
    const locked = section(
      'Nastavitve (zaklenjeno)',
      rows([
        ['Strategija', t.strategy_name],
        ['Parametri', params.length ? params.map(([k, v]) => `${k} = ${String(v)}`).join(', ') : 'brez parametrov'],
        ['Sredstva', t.instruments.join(', ')],
        ['Borza', venueName],
        ['Obdobje', `${t.from} do ${t.to}`],
        ['Časovni okvir', TIMEFRAME_LABELS[r.timeframe ?? '1m'] ?? r.timeframe ?? '1 minuta'],
      ['Začetni kapital', r.initialCapital.toFixed(2)],
        ['Financiran račun', t.prop_plan ? `${t.prop_plan.firm_name} – ${t.prop_plan.plan_name}` : 'ni izbran'],
        ['Bruto dobiček', money(r.grossProfit)],
        ['Provizije', r.costs.commission.toFixed(2)],
        ['Razpon', r.costs.spread.toFixed(2)],
        ['Skupni stroški', r.costs.total.toFixed(2)],
      ]),
    );
    const left = make('div');
    left.append(mentorMetrics, chart, locked);
    if (r.challenge) left.append(rulesSection(r.challenge));
    left.append(trades);
    const right = make('div');
    right.append(section('Komentarji', commentsBox), section('Odločitev in zgodovina stanj', reviewBox));
    const layout = make('div', 'split review-layout');
    layout.append(left, right);
    container.append(header, lock, layout);
    pending.push(renderComments(commentsBox, t.id, t.status, 'mentor', reload, onUnauthorized));
  } else if (foreign) {
    const note = make('p', 'readonly-note', `Deljeni test uporabnika ${t.owner.name}: samo za branje.`);
    container.append(header, note, metrics, settings, chart, cards, trades);
  } else {
    // Lastnik: vidnost testa (Deli / Prekliči deljenje s potrditvijo) in razdelka Mentorski pregled, Mentorjev odziv.
    const shareMessage = make('p', 'error');
    shareMessage.setAttribute('role', 'alert');
    header.append(
      make('span', 'badge', VISIBILITY_LABELS[t.visibility]),
      visibilityControl(`/api/backtests/${t.id}/visibility`, t.visibility, reload, (text) => (shareMessage.textContent = text), onUnauthorized),
    );
    const review = section('Mentorski pregled', reviewBox);
    container.append(header, shareMessage, metrics, review, settings, chart, cards, trades);
    // Mentorjev odziv: stanje, komentarji samo za branje in »Ponovi test«; razdelek se pokaže, ko je test oddan.
    if (t.status !== 'draft') {
      container.append(section('Mentorjev odziv', commentsBox));
      pending.push(renderFeedback(commentsBox, t, reload, onUnauthorized));
    }
  }
  if (!foreign) pending.push(renderReview(reviewBox, t, reload, onUnauthorized, role));
  await Promise.all(pending);
}
