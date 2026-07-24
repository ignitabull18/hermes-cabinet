import { errors, type Locator, type Page } from "@playwright/test";

import {
  ASSISTANT_MESSAGE_CONTENT_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
} from "../../src/lib/agents/assistant-message-contract";
import type {
  AcceptanceMessageExactnessEvidence,
} from "./contracts";
import {
  TRANSPORT_TOKEN,
  type AcceptanceConversation,
} from "./transport";

function exact(value: string): boolean {
  return value === TRANSPORT_TOKEN;
}

async function innerTextAt(locator: Locator, index: number): Promise<string | null> {
  if (index >= await locator.count()) return null;
  return locator.nth(index).innerText();
}

/**
 * Capture content-free persisted/rendered equality evidence before any exact
 * assertion can abort the live acceptance stage.
 */
export async function captureMessageExactnessEvidence(
  page: Page,
  appUrl: string,
  conversation: AcceptanceConversation,
): Promise<AcceptanceMessageExactnessEvidence[]> {
  await page.goto(
    `${appUrl}/tasks/${encodeURIComponent(conversation.conversationId)}`,
  );
  const messageBodies = page.locator(
    `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`,
  );
  const turnContainers = page.locator(ASSISTANT_TURN_SELECTOR);

  // TaskConversationPage loads durable turns in a client effect after the
  // document load event. Locator.count() is an immediate snapshot, so reading
  // it here without an explicit DOM cardinality barrier races that fetch and
  // can report zero even when both persisted turns render moments later.
  try {
    await page.waitForFunction(
      ({ selector, expected }) =>
        document.querySelectorAll(selector).length === expected,
      {
        selector:
          `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`,
        expected: 2,
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    // Preserve the content-free equality ledger on a genuine cardinality
    // timeout; assertMessageExactnessEvidence will still fail closed on the
    // captured count. Navigation/browser errors remain immediate failures.
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
  const elementCount = await messageBodies.count();
  const persisted = [conversation.firstResponse, conversation.secondResponse];

  return Promise.all(
    (["initial", "follow-up"] as const).map(async (turn, index) => {
      const renderedMessageBody = await innerTextAt(messageBodies, index);
      const largerContainer = await innerTextAt(turnContainers, index);
      const responseExactness = index === 0
        ? conversation.responseExactness.initial
        : conversation.responseExactness.followUp;
      return {
        turn,
        rawModelFinalExact: responseExactness.rawModelFinalExact,
        acpNormalizedExact: responseExactness.acpNormalizedExact,
        persistedExact: exact(persisted[index]),
        renderedMessageBodyExact:
          renderedMessageBody === null ? false : exact(renderedMessageBody),
        harnessExtractionExact: exact(persisted[index]),
        largerContainerExact:
          largerContainer === null ? false : exact(largerContainer),
        selector:
          `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`,
        elementCount,
      };
    }),
  );
}

export function assertMessageExactnessEvidence(
  evidence: AcceptanceMessageExactnessEvidence[],
): void {
  if (evidence.length !== 2) {
    throw new Error("assistant exactness did not record both bounded turns");
  }
  for (const entry of evidence) {
    if (entry.elementCount !== 2) {
      throw new Error("assistant message-content selector did not resolve exactly two elements");
    }
    if (!entry.persistedExact) {
      throw new Error(`${entry.turn} persisted response was not the exact acceptance token`);
    }
    if (entry.rawModelFinalExact === false) {
      throw new Error(`${entry.turn} raw model final response was not exact`);
    }
    if (entry.acpNormalizedExact !== true) {
      throw new Error(`${entry.turn} ACP normalized response was not exact`);
    }
    if (!entry.harnessExtractionExact) {
      throw new Error(`${entry.turn} harness extraction was not exact`);
    }
    if (!entry.renderedMessageBodyExact) {
      throw new Error(`${entry.turn} rendered message body was not the exact acceptance token`);
    }
  }
}
