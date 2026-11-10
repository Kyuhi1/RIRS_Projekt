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
  svg.append(el('polyline', { points: curve.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' '), class: 'line' }));
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
  container.append(svg);
}
