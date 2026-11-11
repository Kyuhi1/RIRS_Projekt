// Stroj stanj testa (US-12 do US-14). Čista funkcija: ne ve za bazo, uporabnike ali povezave mentorja;
// kdo sme izvesti dejanje (lastnik ali mentor testa), določa `actor`.
export const STATUSES = ['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];

export const ACTIONS = ['submit', 'withdraw', 'start-review', 'request-changes', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

export type Actor = 'owner' | 'reviewer';

interface Transition {
  action: Action;
  from: Status;
  to: Status;
  actor: Actor;
}

// Vsi dovoljeni prehodi. Stanja changes_requested, approved in withdrawn so končna: po zahtevanih
// spremembah trgovec ustvari nov test (»Ponovi test«), umaknjenega testa pa ni mogoče znova oddati.
export const TRANSITIONS: readonly Transition[] = [
  { action: 'submit', from: 'draft', to: 'submitted', actor: 'owner' },
  { action: 'withdraw', from: 'submitted', to: 'withdrawn', actor: 'owner' },
  { action: 'start-review', from: 'submitted', to: 'in_review', actor: 'reviewer' },
  { action: 'request-changes', from: 'in_review', to: 'changes_requested', actor: 'reviewer' },
  { action: 'approve', from: 'in_review', to: 'approved', actor: 'reviewer' },
];

export type Outcome =
  | { ok: true; to: Status }
  | { ok: false; reason: 'invalid_state' | 'forbidden' }; // napačno stanje za dejanje oziroma dejanje ni za tega udeleženca

// Rezultat dejanja v danem stanju. Najprej se preveri stanje, nato udeleženec, da klicatelj
// pri napačnem stanju dobi razlog stanja (npr. umik v pregledu), ne razloga o pravicah.
export function transition(status: Status, action: Action, actor: Actor): Outcome {
  const candidate = TRANSITIONS.find((t) => t.action === action && t.from === status);
  if (!candidate) return { ok: false, reason: 'invalid_state' };
  if (candidate.actor !== actor) return { ok: false, reason: 'forbidden' };
  return { ok: true, to: candidate.to };
}
