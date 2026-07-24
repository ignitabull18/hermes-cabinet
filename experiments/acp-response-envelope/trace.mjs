export const TOKEN = "CABINET_ACCEPTANCE_OK";

// This is deliberately synthetic. The live response bytes were removed from
// the retained acceptance artifact. The fixture preserves only the measured
// property under test: operator-report text surrounds the exact token.
export const SYNTHETIC_OPERATOR_ENVELOPE = [
  "Changed: none",
  `Evidence: ${TOKEN}`,
  "Success criteria: response completed",
  "Next action: none",
].join("\n");

export function classify(value) {
  const tokenIndex = value.indexOf(TOKEN);
  const prefix = tokenIndex > 0 ? value.slice(0, tokenIndex) : "";
  const suffix = tokenIndex >= 0 ? value.slice(tokenIndex + TOKEN.length) : "";
  return {
    exact: value === TOKEN,
    prefix_present: prefix.length > 0,
    suffix_present: suffix.length > 0,
    structured_envelope_present:
      /(?:^|\n)(?:Changed|Evidence|Success criteria|Next action):/m.test(value),
    metadata_in_body: false,
  };
}

/**
 * Model the text-only operations of the measured ACP/Cabinet path. Every
 * operation is backed by a source-contract assertion in trace.test.mjs.
 */
export function traceFromAcpBlocks(blocks) {
  const rawAcp = blocks.join("");
  const officialSdk = blocks.join("");
  const sharedCore = officialSdk;
  const adapterResult = sharedCore;
  const persistedTurn = adapterResult.trim();
  const detailApi = persistedTurn;
  const renderedMessage = detailApi;
  const harnessExtraction = detailApi.trim();

  return [
    ["raw_acp_assistant_content_blocks", rawAcp],
    ["official_sdk_normalized_notifications", officialSdk],
    ["shared_transport_core_normalized_chunks", sharedCore],
    ["final_adapter_result", adapterResult],
    ["persisted_cabinet_assistant_turn", persistedTurn],
    ["conversation_detail_api_response", detailApi],
    ["rendered_assistant_message_dom", renderedMessage],
    ["acceptance_harness_extracted_text", harnessExtraction],
  ].map(([layer, value]) => ({ layer, value, ...classify(value) }));
}
