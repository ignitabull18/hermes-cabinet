import { errors, type Locator, type Page } from "@playwright/test";

import {
  ASSISTANT_MESSAGE_CONTENT_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
} from "../../src/lib/agents/assistant-message-contract";
import type {
  AcceptanceMessageFidelityEvidence,
} from "./contracts";
import {
  TRANSPORT_NONCE,
  type AcceptanceConversation,
} from "./transport";

function nonceOccurrenceCount(value: string): number {
  return value.split(TRANSPORT_NONCE).length - 1;
}

function hasAlteredOrPartialNonce(value: string): boolean {
  const candidates = value.match(/CABINET-NONCE-[A-Za-z0-9_-]+/g) ?? [];
  return candidates.some((candidate) => candidate !== TRANSPORT_NONCE);
}

async function innerTextAt(locator: Locator, index: number): Promise<string | null> {
  if (index >= await locator.count()) return null;
  return locator.nth(index).innerText();
}

/**
 * Capture content-free persisted/rendered equality evidence before any exact
 * assertion can abort the live acceptance stage.
 */
export async function captureMessageFidelityEvidence(
  page: Page,
  appUrl: string,
  conversation: AcceptanceConversation,
): Promise<AcceptanceMessageFidelityEvidence[]> {
  await page.goto(
    `${appUrl}/tasks/${encodeURIComponent(conversation.conversationId)}`,
  );
  const messageBodies = page.locator(
    `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`,
  );

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
    // timeout; assertMessageFidelityEvidence will still fail closed on the
    // captured count. Navigation/browser errors remain immediate failures.
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
  const elementCount = await messageBodies.count();
  const persisted = [conversation.firstResponse, conversation.secondResponse];

  return Promise.all(
    (["initial", "follow-up"] as const).map(async (turn, index) => {
      const renderedMessageBody = await innerTextAt(messageBodies, index);
      const persistedContent = persisted[index];
      const renderedContent = renderedMessageBody ?? "";
      const occurrences = nonceOccurrenceCount(renderedContent);
      return {
        turn,
        exactNoncePresent: occurrences === 1,
        nonceOccurrenceCount: occurrences,
        surroundingFormattingPresent:
          renderedContent.trim() !== TRANSPORT_NONCE,
        alteredOrPartialNoncePresent:
          hasAlteredOrPartialNonce(renderedContent) ||
          hasAlteredOrPartialNonce(persistedContent),
        persistedContentMatchesRenderedContent:
          renderedMessageBody !== null && persistedContent === renderedContent,
        sessionContextPreserved:
          conversation.sameSession &&
          nonceOccurrenceCount(persistedContent) === 1,
        selector:
          `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`,
        elementCount,
      };
    }),
  );
}

export function assertMessageFidelityEvidence(
  evidence: AcceptanceMessageFidelityEvidence[],
): void {
  if (evidence.length !== 2) {
    throw new Error("assistant fidelity did not record both bounded turns");
  }
  for (const entry of evidence) {
    if (entry.elementCount !== 2) {
      throw new Error("assistant message-content selector did not resolve exactly two elements");
    }
    if (!entry.exactNoncePresent || entry.nonceOccurrenceCount !== 1) {
      throw new Error(
        `${entry.turn} assistant content did not contain the exact acceptance nonce exactly once`,
      );
    }
    if (entry.alteredOrPartialNoncePresent) {
      throw new Error(`${entry.turn} assistant content contained an altered acceptance nonce`);
    }
    if (!entry.sessionContextPreserved) {
      throw new Error(`${entry.turn} native session context was not preserved`);
    }
  }
}
