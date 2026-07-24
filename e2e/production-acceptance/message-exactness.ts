import type { Locator, Page } from "@playwright/test";

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
  const elementCount = await messageBodies.count();
  const persisted = [conversation.firstResponse, conversation.secondResponse];

  return Promise.all(
    (["initial", "follow-up"] as const).map(async (turn, index) => {
      const renderedMessageBody = await innerTextAt(messageBodies, index);
      const largerContainer = await innerTextAt(turnContainers, index);
      return {
        turn,
        persistedExact: exact(persisted[index]),
        renderedMessageBodyExact:
          renderedMessageBody === null ? false : exact(renderedMessageBody),
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
    if (!entry.renderedMessageBodyExact) {
      throw new Error(`${entry.turn} rendered message body was not the exact acceptance token`);
    }
  }
}
