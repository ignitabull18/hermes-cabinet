import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSISTANT_MESSAGE_CONTENT_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
} from "../../src/lib/agents/assistant-message-contract";
import {
  assertMessageFidelityEvidence,
} from "./message-exactness";

const selector =
  `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`;

function accepted(
  turn: "initial" | "follow-up",
  surroundingFormattingPresent: boolean,
) {
  return {
    turn,
    exactNoncePresent: true,
    nonceOccurrenceCount: 1,
    surroundingFormattingPresent,
    alteredOrPartialNoncePresent: false,
    persistedContentMatchesRenderedContent: !surroundingFormattingPresent,
    sessionContextPreserved: true,
    selector,
    elementCount: 2,
  };
}

test("exactly-once nonce fidelity permits surrounding operator formatting", () => {
  assert.doesNotThrow(() =>
    assertMessageFidelityEvidence([
      accepted("initial", true),
      accepted("follow-up", false),
    ]),
  );
});

test("persisted/rendered byte equality is classified separately and is nonblocking", () => {
  const initial = accepted("initial", true);
  initial.persistedContentMatchesRenderedContent = false;
  assert.doesNotThrow(() =>
    assertMessageFidelityEvidence([
      initial,
      accepted("follow-up", false),
    ]),
  );
});

test("missing, repeated, altered, or partial nonce forms fail closed", () => {
  const invalid = [
    { exactNoncePresent: false, nonceOccurrenceCount: 0 },
    { exactNoncePresent: false, nonceOccurrenceCount: 2 },
    { alteredOrPartialNoncePresent: true },
    { sessionContextPreserved: false },
  ];
  for (const override of invalid) {
    assert.throws(
      () =>
        assertMessageFidelityEvidence([
          { ...accepted("initial", true), ...override },
          accepted("follow-up", false),
        ]),
      /acceptance nonce|session context/,
    );
  }
});

test("missing or duplicate assistant-content boundaries fail closed", () => {
  for (const elementCount of [0, 1, 3]) {
    assert.throws(
      () =>
        assertMessageFidelityEvidence([
          { ...accepted("initial", true), elementCount },
          { ...accepted("follow-up", false), elementCount },
        ]),
      /did not resolve exactly two elements/,
    );
  }
});

test("the production selector identifies only the assistant persisted-content semantic", () => {
  assert.equal(
    selector,
    '[data-testid="turn"][data-turn-role="agent"] > ' +
      '[data-testid="assistant-message-content"]' +
      '[data-message-author="assistant"][data-message-part="content"]',
  );
  assert.doesNotMatch(selector, /class|:nth|text=|CABINET-NONCE/);
});
