/**
 * Stable, accessible boundaries for one rendered conversation turn.
 *
 * The acceptance harness imports these values instead of guessing at the
 * component's DOM structure. In particular, assistant content is deliberately
 * narrower than the containing turn so role, time, lifecycle, diagnostics, and
 * actions can never be mistaken for model-authored text.
 */
export const TURN_TEST_IDS = {
  turn: "turn",
  metadata: "turn-metadata",
  roleLabel: "turn-role-label",
  timestamp: "turn-timestamp",
  lifecycleStatus: "turn-lifecycle-status",
  assistantContent: "assistant-message-content",
  userContent: "user-message-content",
  metadataActions: "turn-metadata-actions",
  failureDetails: "turn-failure-details",
} as const;

export const ASSISTANT_MESSAGE_CONTENT_SELECTOR =
  `[data-testid="${TURN_TEST_IDS.assistantContent}"]`;

export const ASSISTANT_TURN_SELECTOR =
  `[data-testid="${TURN_TEST_IDS.turn}"][data-turn-role="agent"]`;
