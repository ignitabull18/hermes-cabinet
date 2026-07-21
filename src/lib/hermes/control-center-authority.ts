import type {
  HermesCapabilityEvidenceCatalog,
  HermesEvidenceOrigin,
  HermesProjectionProvenance,
  HermesProofKind,
  HermesProofScope,
} from "./control-center-types";

export type HermesEvidenceAuthority = {
  origin: HermesEvidenceOrigin;
  provenanceKind: HermesProjectionProvenance["kind"];
  proofKind: HermesProofKind;
  proofScope: HermesProofScope;
};

export type HermesAuthorityValidation =
  | { valid: true; code: "valid" }
  | { valid: false; code: "invalid_raw_authority" | "invalid_catalog_authority" | "invalid_derived_authority" };

/** The single authority boundary for Hermes Control Center evidence. */
export function validateHermesEvidenceAuthority(authority: HermesEvidenceAuthority): HermesAuthorityValidation {
  const { origin, provenanceKind, proofKind, proofScope } = authority;
  if (origin === "raw_observation") {
    const valid = provenanceKind === "live_runtime"
      ? (proofKind === "live" && (proofScope === "live_runtime_operation" || proofScope === "cabinet_local_surface")) ||
        (proofKind === "detected_metadata" && proofScope === "configured_profile_metadata")
      : proofKind === "exact_fixture" && (proofScope === "exact_fixture_path" || proofScope === "cabinet_local_surface");
    return valid ? { valid: true, code: "valid" } : { valid: false, code: "invalid_raw_authority" };
  }
  if (origin === "approved_evidence_catalog") {
    const valid = proofKind === "historical_audit" &&
      (proofScope === "source_audit" || proofScope === "historical_live_acceptance");
    return valid ? { valid: true, code: "valid" } : { valid: false, code: "invalid_catalog_authority" };
  }
  const valid = provenanceKind === "live_runtime"
    ? proofKind === "live" && proofScope === "live_runtime_operation"
    : proofKind === "exact_fixture" && proofScope === "exact_fixture_path";
  return valid ? { valid: true, code: "valid" } : { valid: false, code: "invalid_derived_authority" };
}

export function invalidHermesEvidenceCatalogEntries(catalog: HermesCapabilityEvidenceCatalog): string[] {
  const invalid: string[] = [];
  for (const [capabilityId, entry] of Object.entries(catalog)) {
    for (const [index, proof] of (entry?.historical ?? []).entries()) {
      const authority = validateHermesEvidenceAuthority({
        origin: "approved_evidence_catalog",
        provenanceKind: "live_runtime",
        proofKind: proof.proofKind,
        proofScope: proof.proofScope,
      });
      if (!authority.valid) invalid.push(`${capabilityId}:historical:${index}:${authority.code}`);
    }
  }
  return invalid;
}

export function assertValidHermesEvidenceCatalog(catalog: HermesCapabilityEvidenceCatalog): void {
  const invalid = invalidHermesEvidenceCatalogEntries(catalog);
  if (invalid.length) throw new Error(`Hermes evidence catalog contains invalid authority (${invalid.slice(0, 5).join(", ")}).`);
}
