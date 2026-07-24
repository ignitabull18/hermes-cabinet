import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSISTANT_MESSAGE_CONTENT_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
} from "../../src/lib/agents/assistant-message-contract";
import {
  assertMessageExactnessEvidence,
} from "./message-exactness";

const selector =
  `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`;

test("exact persisted and rendered message-body evidence passes independently of its container", () => {
  assert.doesNotThrow(() =>
    assertMessageExactnessEvidence([
      {
        turn: "initial",
        persistedExact: true,
        renderedMessageBodyExact: true,
        largerContainerExact: false,
        selector,
        elementCount: 2,
      },
      {
        turn: "follow-up",
        persistedExact: true,
        renderedMessageBodyExact: true,
        largerContainerExact: false,
        selector,
        elementCount: 2,
      },
    ]),
  );
});

test("a persisted operator envelope still fails even if a body projection looks exact", () => {
  assert.throws(
    () =>
      assertMessageExactnessEvidence([
        {
          turn: "initial",
          persistedExact: false,
          renderedMessageBodyExact: true,
          largerContainerExact: false,
          selector,
          elementCount: 2,
        },
        {
          turn: "follow-up",
          persistedExact: true,
          renderedMessageBodyExact: true,
          largerContainerExact: false,
          selector,
          elementCount: 2,
        },
      ]),
    /initial persisted response was not the exact acceptance token/,
  );
});

test("missing, duplicate, or non-exact rendered message bodies fail closed", () => {
  for (const elementCount of [0, 1, 3]) {
    assert.throws(
      () =>
        assertMessageExactnessEvidence([
          {
            turn: "initial",
            persistedExact: true,
            renderedMessageBodyExact: elementCount !== 1,
            largerContainerExact: false,
            selector,
            elementCount,
          },
          {
            turn: "follow-up",
            persistedExact: true,
            renderedMessageBodyExact: true,
            largerContainerExact: false,
            selector,
            elementCount,
          },
        ]),
      /did not resolve exactly two elements/,
    );
  }
});
