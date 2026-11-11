import type { EquityPoint } from './equityChart';

export interface CompareSeries {
  label: string; // npr. »#3 Buy & Hold«
  initialCapital: number;
  curve: EquityPoint[];
}

// Barve in vzorci črt so različni, da so krivulje ločljive tudi brez barv.
export const SERIES_STYLES = [
  { color: '#1f5fbf', dash: '' },
  { color: '#d9730d', dash: '6 3' },
  { color: '#1b8a5a', dash: '2 3' },
  { color: '#8a3fb5', dash: '8 3 2 3' },
];

const NS = 'http://www.w3.org/2000/svg';
const W = 800;
const H = 260;
const PAD = { left: 56, right: 12, top: 12, bottom: 28 };

function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

// Skupen graf testov (US-09): donosnost v % glede na začetni kapital posameznega testa na skupni časovni osi,
// ker imajo testi lahko različen kapital in obdobje. Pod grafom je legenda.
export function renderCompareChart(container: HTMLElement, series: CompareSeries[]): void {
  container.replaceChildren();
  const lines = series.map((s) => ({ ...s, points: s.curve.map((p) => ({ t: day(p.date), r: (p.value / s.initialCapital - 1) * 100 })) }));
  const all = lines.flatMap((l) => l.points);
  if (all.length === 0) {
    container.textContent = 'Krivulje niso na voljo.';
    return;
  }
  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  let rMin = Math.min(0, ...all.map((p) => p.r));
  let rMax = Math.max(0, ...all.map((p) => p.r));
  if (rMin === rMax) {
    rMin -= 1;
    rMax += 1;
  }
  const x = (t: number) => PAD.left + (tMax === tMin ? (W - PAD.left - PAD.right) / 2 : ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right));
  const y = (r: number) => PAD.top + ((rMax - r) / (rMax - rMin)) * (H - PAD.top - PAD.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Primerjava krivulj vrednosti računa' });
  for (const v of [rMax, (rMax + rMin) / 2, rMin]) {
    svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: PAD.left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, `${v.toFixed(1)} %`));
  }
  svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(0), y2: y(0), class: 'baseline' }));
  lines.forEach((line, i) => {
    const style = SERIES_STYLES[i % SERIES_STYLES.length]!;
    const attrs: Record<string, string | number> = {
      points: line.points.map((p) => `${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join(' '),
      class: 'compare-line', stroke: style.color, 'data-series': i,
    };
    if (style.dash) attrs['stroke-dasharray'] = style.dash;
    svg.append(el('polyline', attrs));
    if (line.points.length === 1) svg.append(el('circle', { cx: x(line.points[0]!.t), cy: y(line.points[0]!.r), r: 3, fill: style.color }));
  });
  svg.append(el('text', { x: PAD.left, y: H - 8, class: 'axis' }, new Date(tMin).toISOString().slice(0, 10)));
  svg.append(el('text', { x: W - PAD.right, y: H - 8, 'text-anchor': 'end', class: 'axis' }, new Date(tMax).toISOString().slice(0, 10)));

  const legend = document.createElement('ul');
  legend.className = 'legend';
  lines.forEach((line, i) => {
    const style = SERIES_STYLES[i % SERIES_STYLES.length]!;
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.borderTopColor = style.color;
    swatch.style.borderTopStyle = style.dash ? 'dashed' : 'solid';
    item.append(swatch, document.createTextNode(line.label));
    legend.append(item);
  });
  container.append(svg, legend);
}
