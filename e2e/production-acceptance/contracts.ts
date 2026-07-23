export type AcceptanceStatus = "passed" | "failed" | "blocked" | "not_run";

export interface AcceptanceCheck {
  id: string;
  area: string;
  status: AcceptanceStatus;
  summary: string;
  evidence?: Record<string, unknown>;
}

export interface AcceptanceBlocker {
  id: string;
  area: string;
  summary: string;
  reproduction: string[];
  ownerHint?: string;
}

export interface RouteChecklistEntry {
  route: string;
  source: string;
  kind: "static" | "dynamic" | "spa";
  discovered: boolean;
  exercised: boolean;
  status: AcceptanceStatus;
  note?: string;
}

export interface ScreenshotEntry {
  id: string;
  file: string;
  viewport: { width: number; height: number };
  reducedMotion: boolean;
  route: string;
  purpose: string;
}

export interface NetworkSummary {
  total: number;
  byMethod: Record<string, number>;
  byPath: Record<string, number>;
  failed: Array<{ method: string; path: string; reason: string }>;
  legacyDaemonOutputRequests: number;
  searchRequests: number;
  ptyCreateOrWriteRequests: number;
  modelMessageRequests: number;
  consequentialHermesMutations: number;
  mutations: number;
}

export interface BrowserIssue {
  stage: string;
  source: "console" | "pageerror" | "http";
  severity: "warning" | "error";
  summary: string;
  path?: string;
  expectedUnavailableProjection?: boolean;
  expectedControlledRestart?: boolean;
}

export interface ConversationTurnDiagnostic {
  identity: string;
  sequence: number;
  role: "user" | "agent";
  lifecycleState: "pending" | "completed" | "failed";
}

export interface ConversationCheckpointEvidence {
  checkpoint: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
  recordedAt: string;
  eventType: string;
  conversationIdentity: string | null;
  nativeSessionIdentity: string | null;
  requestIdentity: "initial" | "follow-up" | null;
  turns: ConversationTurnDiagnostic[];
  durableStoreCounts: {
    user: number;
    assistant: number;
    completedAssistant: number;
    total: number;
    duplicateTurnIdentities: number;
  } | null;
  inMemoryCounts: {
    user: number;
    assistant: number;
    completedAssistant: number;
    total: number;
  } | null;
  pendingRequiredWrites: number | null;
}

export interface ConversationPersistenceEvidence {
  schemaVersion: 1;
  transport: string;
  modelRequestCount: number;
  checkpoints: ConversationCheckpointEvidence[];
  nativeSessionIdentityStable: boolean | null;
  exactFinalCardinality: boolean | null;
  secondRestartCompleted: boolean;
  unavailableMeasurements: string[];
}

export interface AcceptanceResult {
  schemaVersion: 2;
  generatedAt: string;
  verdict: "ACCEPTED" | "NOT_ACCEPTED";
  stream: "acceptance-harness";
  branch: string;
  testedBaseRevision: string;
  applicationDiffFromBase: string[];
  environment: {
    url: string;
    appPort: number;
    runtimeMode: "hermes";
    data: "isolated";
    productionTouched: false;
    liveModelMessagesSent: number;
    transport: string;
    skillsMode: "fixture" | "production";
    browserPath: string;
  };
  routes: RouteChecklistEntry[];
  visibleNavigation: {
    desktop: string[];
    mobile: string[];
  };
  checks: AcceptanceCheck[];
  blockers: AcceptanceBlocker[];
  network: NetworkSummary;
  browserIssues: BrowserIssue[];
  conversationPersistence: ConversationPersistenceEvidence | null;
  screenshots: ScreenshotEntry[];
  scans: {
    secretIndicators: string[];
    localPathIndicators: string[];
  };
  productionTouched: false;
}
