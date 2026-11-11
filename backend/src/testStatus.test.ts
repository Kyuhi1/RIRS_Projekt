import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, STATUSES, TRANSITIONS, transition, type Action, type Actor, type Status } from './testStatus.ts';

test('dovoljeni prehodi vodijo v pravo stanje', () => {
  assert.deepEqual(transition('draft', 'submit', 'owner'), { ok: true, to: 'submitted' });
  assert.deepEqual(transition('submitted', 'withdraw', 'owner'), { ok: true, to: 'withdrawn' });
  assert.deepEqual(transition('submitted', 'start-review', 'reviewer'), { ok: true, to: 'in_review' });
  assert.deepEqual(transition('in_review', 'request-changes', 'reviewer'), { ok: true, to: 'changes_requested' });
  assert.deepEqual(transition('in_review', 'approve', 'reviewer'), { ok: true, to: 'approved' });
});

test('umik je mogoč samo v stanju submitted, v in_review ne', () => {
  assert.deepEqual(transition('in_review', 'withdraw', 'owner'), { ok: false, reason: 'invalid_state' });
  for (const status of STATUSES.filter((s) => s !== 'submitted')) {
    assert.equal(transition(status, 'withdraw', 'owner').ok, false, status);
  }
});

test('oddaja je mogoča samo iz osnutka', () => {
  for (const status of STATUSES.filter((s) => s !== 'draft')) {
    assert.deepEqual(transition(status, 'submit', 'owner'), { ok: false, reason: 'invalid_state' }, status);
  }
});

test('vsi ostali prehodi so zavrnjeni: dovoljeni so natanko prehodi iz tabele', () => {
  const actors: Actor[] = ['owner', 'reviewer'];
  let allowed = 0;
  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      for (const actor of actors) {
        const expected = TRANSITIONS.some((t) => t.from === status && t.action === action && t.actor === actor);
        const result = transition(status, action, actor);
        assert.equal(result.ok, expected, `${status} ${action} ${actor}`);
        if (result.ok) allowed++;
      }
    }
  }
  assert.equal(allowed, 5);
});

test('napačen udeleženec je zavrnjen z razlogom forbidden, napačno stanje z invalid_state', () => {
  assert.deepEqual(transition('draft', 'submit', 'reviewer'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(transition('submitted', 'withdraw', 'reviewer'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(transition('submitted', 'start-review', 'owner'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(transition('in_review', 'approve', 'owner'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(transition('in_review', 'request-changes', 'owner'), { ok: false, reason: 'forbidden' });
  // napačno stanje ima prednost pred udeležencem
  assert.deepEqual(transition('approved', 'approve', 'owner'), { ok: false, reason: 'invalid_state' });
});

test('končna stanja nimajo izhodnih prehodov', () => {
  for (const status of ['changes_requested', 'approved', 'withdrawn'] as Status[]) {
    assert.equal(TRANSITIONS.some((t) => t.from === status), false, status);
    for (const action of ACTIONS as readonly Action[]) assert.equal(transition(status, action, 'owner').ok || transition(status, action, 'reviewer').ok, false);
  }
});

test('stroj stanj ne spreminja vhodnih podatkov in je deterministična funkcija', () => {
  const before = JSON.stringify(TRANSITIONS);
  assert.deepEqual(transition('draft', 'submit', 'owner'), transition('draft', 'submit', 'owner'));
  assert.equal(JSON.stringify(TRANSITIONS), before);
});

test('vsako stanje in dejanje v tabeli je znano', () => {
  for (const t of TRANSITIONS) {
    assert.ok(STATUSES.includes(t.from) && STATUSES.includes(t.to) && ACTIONS.includes(t.action));
    assert.notEqual(t.from, t.to);
  }
});
