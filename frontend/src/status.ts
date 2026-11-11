// Slovenski nazivi stanj testa (stroj stanj je v backend/src/testStatus.ts).
export const STATUS_LABELS: Record<string, string> = {
  draft: 'Osnutek',
  submitted: 'Oddan mentorju',
  in_review: 'V pregledu',
  changes_requested: 'Zahtevane spremembe',
  approved: 'Odobren',
  withdrawn: 'Umaknjen',
};

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

// Datum in ura v krajevni obliki, »–« brez vrednosti.
export const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }) : '–');

// Značka stanja testa (pill): barva po stanju, besedilo je vedno zraven, da se stanja ločijo tudi brez barve.
export function statusBadge(status: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = `badge badge-${status}`;
  node.textContent = statusLabel(status);
  return node;
}
