import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Turn } from "@/types/tasks";
import { TurnBlock } from "./turn-block";

const TOKEN = "CABINET_ACCEPTANCE_OK";
const BASE_TURN: Turn = {
  id: "assistant-safe",
  turn: 1,
  role: "agent",
  ts: "2026-07-23T00:00:00.000Z",
  content: TOKEN,
};

function render(turn: Partial<Turn> = {}): string {
  return renderToStaticMarkup(
    React.createElement(TurnBlock, { turn: { ...BASE_TURN, ...turn } }),
  );
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

test("assistant content has a dedicated identity separate from role, time, and lifecycle", () => {
  const markup = render();
  assert.match(markup, /data-testid="assistant-message-content"/);
  assert.match(markup, /aria-label="Assistant message content"/);
  assert.match(markup, /data-testid="turn-role-label"[^>]*>Agent</);
  assert.match(markup, /data-testid="turn-timestamp"/);
  assert.match(markup, /data-testid="turn-lifecycle-status"[^>]*>completed</);
  assert.ok(
    markup.indexOf('data-testid="turn-role-label"') <
      markup.indexOf('data-testid="assistant-message-content"'),
  );
  assert.equal(occurrences(markup, TOKEN), 1);
});

test("multiline and markdown content remain inside the assistant body boundary", () => {
  const multiline = render({ content: `${TOKEN}\n${TOKEN}` });
  assert.match(
    multiline,
    /data-testid="assistant-message-content"[\s\S]*CABINET_ACCEPTANCE_OK[\s\S]*CABINET_ACCEPTANCE_OK/,
  );

  const markdown = render({ content: `**${TOKEN}**` });
  assert.match(
    markdown,
    /data-testid="assistant-message-content"[\s\S]*\*\*CABINET_ACCEPTANCE_OK\*\*/,
  );
});

test("streaming, failed, and metadata states never enter assistant content", () => {
  const streaming = render({ content: "", pending: true });
  assert.doesNotMatch(streaming, /data-testid="assistant-message-content"/);
  assert.match(
    streaming,
    /data-testid="turn-lifecycle-status"[^>]*aria-label="Assistant response is in progress"/,
  );

  const failed = render({
    exitCode: 1,
    error: "SAFE_ACCEPTANCE_FAILURE",
  });
  assert.match(failed, /data-testid="assistant-message-content"/);
  assert.match(failed, /data-testid="turn-failure-details"/);
  assert.ok(
    failed.indexOf('data-testid="assistant-message-content"') <
      failed.indexOf('data-testid="turn-failure-details"'),
  );

  const withMetadata = render({
    artifacts: [{ kind: "file-edit", path: "safe-fixture.md", added: 1, removed: 0 }],
  });
  assert.match(withMetadata, /data-testid="turn-metadata-actions"/);
  assert.ok(
    withMetadata.indexOf('data-testid="assistant-message-content"') <
      withMetadata.indexOf('data-testid="turn-metadata-actions"'),
  );
});

test("reload/restart projection and duplicate-chunk defense keep one exact body", () => {
  const before = render();
  const afterReload = render();
  const afterRestart = render();
  assert.equal(afterReload, before);
  assert.equal(afterRestart, before);
  assert.equal(occurrences(before, TOKEN), 1);
  assert.match(before, /max-md:px-3 max-md:py-4/);
});
