import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SYNTHETIC_OPERATOR_ENVELOPE,
  TOKEN,
  classify,
  traceFromAcpBlocks,
} from "./trace.mjs";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("the synthetic operator envelope remains non-exact at every ACP-to-harness layer", () => {
  const splitAt = SYNTHETIC_OPERATOR_ENVELOPE.indexOf(TOKEN) + 7;
  const ledger = traceFromAcpBlocks([
    SYNTHETIC_OPERATOR_ENVELOPE.slice(0, splitAt),
    SYNTHETIC_OPERATOR_ENVELOPE.slice(splitAt),
  ]);

  assert.equal(ledger.length, 8);
  for (const entry of ledger) {
    assert.equal(entry.exact, false, entry.layer);
    assert.equal(entry.prefix_present, true, entry.layer);
    assert.equal(entry.suffix_present, true, entry.layer);
    assert.equal(entry.structured_envelope_present, true, entry.layer);
    assert.equal(entry.metadata_in_body, false, entry.layer);
    assert.equal(entry.value, SYNTHETIC_OPERATOR_ENVELOPE, entry.layer);
  }
});

test("the same pipeline preserves an exact token exactly", () => {
  for (const entry of traceFromAcpBlocks(["CABINET_", "ACCEPTANCE_OK"])) {
    assert.deepEqual(classify(entry.value), {
      exact: true,
      prefix_present: false,
      suffix_present: false,
      structured_envelope_present: false,
      metadata_in_body: false,
    });
  }
});

test("source contract has no downstream operator-envelope injection", async () => {
  const [
    acpClient,
    hermesAdapter,
    runner,
    detailRoute,
    turnBlock,
    harness,
  ] = await Promise.all([
    source("src/lib/hermes/acp-client.ts"),
    source("src/lib/agents/adapters/hermes-runtime.ts"),
    source("src/lib/agents/conversation-runner.ts"),
    source("src/app/api/agents/conversations/[id]/route.ts"),
    source("src/components/tasks/conversation/turn-block.tsx"),
    source("e2e/production-acceptance/transport.ts"),
  ]);

  assert.match(acpClient, /turn\.output \+= update\.content\.text/);
  assert.match(acpClient, /turn\.onDelta\?\.\(update\.content\.text\)/);
  assert.match(hermesAdapter, /output: result\.output/);
  assert.match(runner, /result\.output\?\.trim\(\) \|\| chunks\.join\(""\)\.trim\(\)/);
  assert.match(detailRoute, /NextResponse\.json\(detail\)/);
  assert.match(turnBlock, /ConversationContentViewer text=\{turn\.content\}/);
  assert.match(harness, /\.map\(\(turn\) => turn\.content\.trim\(\)\)/);

  const downstreamSources = [
    acpClient,
    hermesAdapter,
    detailRoute,
    turnBlock,
    harness,
  ].join("\n");
  assert.doesNotMatch(
    downstreamSources,
    /Changed: none|Success criteria: response completed|Next action: none/,
  );
});
