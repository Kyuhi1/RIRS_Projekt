export interface EquityPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

const NS = 'http://www.w3.org/2000/svg';
const W = 800;
const H = 240;
const PAD = { left: 64, right: 12, top: 12, bottom: 28 };

function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface Marker {
  date: string; // YYYY-MM-DD; označi se, če je na krivulji
  label: string;
}

// Krivulja vrednosti računa za celotno obdobje testa (WF-03). Črtkana črta je začetni kapital,
// rdeče navpične črte so označene kršitve pravil financiranega računa.
export function renderEquityChart(container: HTMLElement, curve: EquityPoint[], initialCapital: number, markers: Marker[] = []): void {
  container.replaceChildren();
  if (curve.length === 0) {
    container.textContent = 'Krivulja ni na voljo.';
    return;
  }
  const values = [...curve.map((p) => p.value), initialCapital];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => PAD.left + (curve.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (curve.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + ((max - v) / (max - min)) * (H - PAD.top - PAD.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Krivulja vrednosti računa' });
  for (const v of [max, (max + min) / 2, min]) {
    svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: PAD.left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, v.toFixed(0)));
  }
  svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(initialCapital), y2: y(initialCapital), class: 'baseline' }));
  const points = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  // Rahlo polnilo pod krivuljo: gradient od accent barve do prosojnosti (barve so v CSS tokenih).
  const gradient = el('linearGradient', { id: 'equity-area', x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(el('stop', { offset: '0%', class: 'area-top' }), el('stop', { offset: '100%', class: 'area-bottom' }));
  svg.append(el('defs', {}));
  svg.querySelector('defs')!.append(gradient);
  const floor = (H - PAD.bottom).toFixed(1);
  svg.append(el('path', { d: `M${x(0).toFixed(1)},${floor} L${points.join(' L')} L${x(curve.length - 1).toFixed(1)},${floor} Z`, fill: 'url(#equity-area)' }));
  svg.append(el('polyline', { points: points.join(' '), class: 'line' }));
  const byDate = new Map<string, string[]>();
  for (const m of markers) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m.label]);
  for (const [date, labels] of byDate) {
    const index = curve.findIndex((p) => p.date === date);
    if (index < 0) continue;
    const mx = x(index);
    const side = mx > W - 160 ? 'end' : 'start'; // besedilo se ne sme izteči iz grafa
    svg.append(el('line', { x1: mx, x2: mx, y1: PAD.top, y2: H - PAD.bottom, class: 'violation' }));
    svg.append(el('circle', { cx: mx, cy: y(curve[index]!.value), r: 4, class: 'violation-dot' }));
    svg.append(el('text', { x: mx + (side === 'end' ? -6 : 6), y: PAD.top + 12, 'text-anchor': side, class: 'violation-label' }, `${date}: ${labels.join(', ')}`));
  }
  if (curve.length === 1) svg.append(el('circle', { cx: x(0), cy: y(curve[0]!.value), r: 3, class: 'dot' }));
  svg.append(el('text', { x: PAD.left, y: H - 8, class: 'axis' }, curve[0]!.date));
  svg.append(el('text', { x: W - PAD.right, y: H - 8, 'text-anchor': 'end', class: 'axis' }, curve[curve.length - 1]!.date));
  addTooltip(svg, curve, x, y);
  container.append(svg);
}

// Tooltip ob hoverju: navpična vodilna črta, pika na krivulji in oznaka z datumom ter vrednostjo.
function addTooltip(svg: SVGElement, curve: EquityPoint[], x: (i: number) => number, y: (v: number) => number): void {
  const hover = el('g', { class: 'hover', visibility: 'hidden' });
  const guide = el('line', { y1: PAD.top, y2: H - PAD.bottom, class: 'hover-line' });
  const dot = el('circle', { r: 5, class: 'hover-dot' });
  const box = el('rect', { height: 24, rx: 6, class: 'hover-box' });
  const label = el('text', { class: 'hover-text' });
  hover.append(guide, dot, box, label);
  svg.append(hover);
  svg.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const raw = curve.length === 1 ? 0 : Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (curve.length - 1));
    const index = Math.min(curve.length - 1, Math.max(0, raw));
    const point = curve[index]!;
    const cx = x(index);
    const cy = y(point.value);
    label.textContent = `${point.date}: ${point.value.toFixed(2)}`;
    const width = 16 + point.date.length * 7 + 62;
    const left = cx + 12 + width > W ? cx - 12 - width : cx + 12;
    const top = Math.max(PAD.top, Math.min(cy - 30, H - PAD.bottom - 28));
    guide.setAttribute('x1', String(cx));
    guide.setAttribute('x2', String(cx));
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    box.setAttribute('x', String(left));
    box.setAttribute('y', String(top));
    box.setAttribute('width', String(width));
    label.setAttribute('x', String(left + 8));
    label.setAttribute('y', String(top + 16));
    hover.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', () => hover.setAttribute('visibility', 'hidden'));
}
