// Supportive, varied messages shown when a user marks an action complete.
// Pulled from a single source so every screen feels consistent and the user
// doesn't see the same phrase every time.
const COMPLETION_MESSAGES = [
  'Done. That was real work.',
  'Completed. Momentum is building.',
  'One less thing. Nice pacing.',
  'Nice — that one is off your plate.',
  'Great. Small wins add up.',
  "You showed up. That's what counts.",
  'Boom. Onto the next when you are ready.',
];

export function pickCompletionMessage(): string {
  return COMPLETION_MESSAGES[Math.floor(Math.random() * COMPLETION_MESSAGES.length)];
}
