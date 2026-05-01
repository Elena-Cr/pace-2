import { describe, it } from 'vitest';

// TODO (Phase 9): Extract Focus.tsx state into a pure reducer / state machine
// (FocusState discriminated union) and add the following tests:
//
// describe('focus state machine', () => {
//   it('takeBreak transitions running -> break with a 5min until', () => {
//     // assert state.kind === 'break' and (state.until - now) within 5min ± tolerance
//   });
//   it('continueMore keeps the old session id until new insert resolves', () => {
//     // assert sessionId remains until success
//   });
// });
//
// For Phase 6 we fixed the four concrete bugs in-place inside Focus.tsx
// (continueMore session ordering, blocked outcome, real break countdown,
// session reuse, and progress mapping) without extracting state, per the
// "watch out" guidance.

describe.skip('focus state machine (pending Phase 9 extraction)', () => {
  it('takeBreak transitions running -> break with a 5min until', () => {});
  it('continueMore keeps the old session id until new insert resolves', () => {});
});
