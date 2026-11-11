import { errorMessage, getJson } from './api';

interface Student {
  id: number;
  name: string;
  email: string;
  tests: number;
  approved: number;
  approvedPct: number | null;
  mistakes: number;
  avgMaxDrawdownPct: number | null;
}
interface Analytics {
  period: string;
  students: Student[];
  total: { tests: number; approved: number; mistakes: number };
  average: { testsPerStudent: number; mistakesPerStudent: number; approvedPct: number | null; avgMaxDrawdownPct: number | null } | null;
}

const PERIODS: { key: string; label: string }[] = [
  { key: '30', label: 'Zadnjih 30 dni' },
  { key: '90', label: 'Zadnjih 90 dni' },
  { key: 'all', label: 'Vse' },
];

const NONE = '–'; // ni podatka (ne 0)
const pct = (value: number | null) => (value === null ? NONE : `${value.toFixed(1)} %`);
const num = (value: number | null) => (value === null ? NONE : String(value));

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Skupna analitika učencev (WF-04, US-15): obdobje (privzeto vse), štiri skupne metrike in tabela učencev.
export function renderStudentAnalytics(box: HTMLElement, onUnauthorized: () => void): void {
  let period = 'all';
  const bar = make('div', 'presets');
  bar.id = 'analytics-period';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Obdobje analitike');
  const content = make('div');
  content.id = 'analytics-body';
  box.append(bar, content);

  const load = async (): Promise<void> => {
    bar.replaceChildren(
      ...PERIODS.map(({ key, label }) => {
        const b = make('button', key === period ? 'active' : undefined, label);
        b.type = 'button';
        b.dataset.period = key;
        b.addEventListener('click', () => {
          period = key;
          void load();
        });
        return b;
      }),
    );
    content.replaceChildren(make('p', 'hint', 'Nalagam ...'));
    const { status, data } = await getJson(`/api/mentor/students/analytics?period=${period}`);
    if (status === 401) return onUnauthorized();
    if (status !== 200) return content.replaceChildren(make('p', 'error', errorMessage(data, 'Analitike ni mogoče naložiti.')));
    draw(data as Analytics);
  };

  const draw = ({ students, total, average }: Analytics): void => {
    if (students.length === 0) return content.replaceChildren(make('p', 'hint', 'Ni aktivnih učencev, zato analitike še ni.'));
    if (total.tests === 0) return content.replaceChildren(make('p', 'hint', 'V izbranem obdobju učenci še nimajo testov za analizo.'));

    const metrics = make('div', 'metrics');
    const metric = (label: string, value: string, hint: string) => {
      const m = make('div', 'metric');
      m.append(make('span', 'hint', label), make('strong', undefined, value), make('span', 'hint', hint));
      return m;
    };
    metrics.append(
      metric('Testi', String(total.tests), `povprečno ${num(average?.testsPerStudent ?? null)} na učenca`),
      metric('Odobreni', pct(average?.approvedPct ?? null), `${total.approved} od ${total.tests}`),
      metric('Napake', String(total.mistakes), `povprečno ${num(average?.mistakesPerStudent ?? null)} na učenca`),
      metric('Povprečni največji padec', pct(average?.avgMaxDrawdownPct ?? null), 'čez vse teste'),
    );

    const table = make('table');
    table.innerHTML = '<thead><tr><th>Učenec</th><th>Testi</th><th>Odobreni</th><th>Napake</th><th>Povpr. največji padec</th></tr></thead>';
    const body = table.createTBody();
    for (const s of students) {
      const row = body.insertRow();
      row.insertCell().textContent = s.name;
      row.insertCell().textContent = String(s.tests);
      row.insertCell().textContent = s.tests === 0 ? NONE : `${pct(s.approvedPct)} (${s.approved})`;
      row.insertCell().textContent = String(s.mistakes);
      row.insertCell().textContent = pct(s.avgMaxDrawdownPct);
    }
    content.replaceChildren(metrics, table);
  };

  void load().catch(() => content.replaceChildren(make('p', 'error', 'Strežnik ni dosegljiv, poskusite znova.')));
}
