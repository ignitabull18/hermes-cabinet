export const INITIAL_PROMPT =
  "This is a local Cabinet transport acceptance test. Do not use tools or contact external systems. Reply with exactly CABINET_TRANSPORT_OK.";
export const FOLLOW_UP_PROMPT =
  "Reply with the exact transport token from your previous response.";
export const TRANSPORT_TOKEN = "CABINET_TRANSPORT_OK";

type CabinetTransportTarget = {
  appUrl: string;
  restart(): Promise<void>;
};

type ConversationMeta = {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  exitCode?: number;
  errorKind?: string;
};

type ConversationDetail = {
  meta: ConversationMeta;
  turns?: Array<{ role: string; content: string }>;
  session?: { resumeId?: string; alive?: boolean } | null;
};

export interface AcceptanceConversation {
  conversationId: string;
  firstResponse: string;
  secondResponse: string;
  sameSession: boolean;
  cabinetRestart: boolean;
}

export interface AcceptanceTransport {
  readonly id: string;
  readonly sendsLiveModelMessages: boolean;
  runTwoTurnContract(cabinet: CabinetTransportTarget): Promise<AcceptanceConversation>;
}

async function payload(response: Response, operation: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function detail(cabinet: CabinetTransportTarget, id: string): Promise<ConversationDetail> {
  const response = await fetch(
    `${cabinet.appUrl}/api/agents/conversations/${encodeURIComponent(id)}?withTurns=1`,
  );
  return await payload(response, "conversation detail") as unknown as ConversationDetail;
}

async function waitForCompletion(
  cabinet: CabinetTransportTarget,
  id: string,
  timeoutMs = 180_000,
): Promise<ConversationDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await detail(cabinet, id);
    if (current.meta.status === "completed") return current;
    if (current.meta.status === "failed") {
      throw new Error(
        `conversation failed (exitCode=${current.meta.exitCode}, errorKind=${current.meta.errorKind})`,
      );
    }
    if (Date.now() > deadline) throw new Error("conversation completion timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function agentResponses(value: ConversationDetail): string[] {
  return (value.turns ?? [])
    .filter((turn) => turn.role === "agent")
    .map((turn) => turn.content.trim());
}

/**
 * The live transport drives Cabinet's real conversation HTTP surface. The
 * Cabinet process is restarted between turns so the follow-up must reload the
 * persisted native Hermes session through the official ACP SDK.
 */
export class LiveCabinetAcpTransport implements AcceptanceTransport {
  readonly id = "hermes-acp-official-sdk";
  readonly sendsLiveModelMessages = true;

  async runTwoTurnContract(cabinet: CabinetTransportTarget): Promise<AcceptanceConversation> {
    const create = await fetch(`${cabinet.appUrl}/api/agents/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSlug: "editor",
        source: "manual",
        userMessage: INITIAL_PROMPT,
      }),
    });
    const created = await payload(create, "initial conversation");
    const conversation = created.conversation as ConversationMeta | undefined;
    if (!conversation?.id) throw new Error("initial conversation returned no identity");

    const first = await waitForCompletion(cabinet, conversation.id);
    const firstSession = first.session?.resumeId ?? "";
    const firstResponses = agentResponses(first);
    if (!firstSession || firstResponses.length !== 1) {
      throw new Error("initial conversation did not persist exactly one native session response");
    }

    await cabinet.restart();

    const followUp = await fetch(
      `${cabinet.appUrl}/api/agents/conversations/${encodeURIComponent(conversation.id)}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userMessage: FOLLOW_UP_PROMPT }),
      },
    );
    await payload(followUp, "follow-up conversation");
    const second = await waitForCompletion(cabinet, conversation.id);
    const secondSession = second.session?.resumeId ?? "";
    const responses = agentResponses(second);
    if (responses.length !== 2) {
      throw new Error("follow-up conversation did not persist exactly two agent responses");
    }

    return {
      conversationId: conversation.id,
      firstResponse: firstResponses[0],
      secondResponse: responses[1],
      sameSession: firstSession === secondSession && firstSession.length > 0,
      cabinetRestart: true,
    };
  }
}

/** Development-only orchestration proof; never yields production acceptance. */
export class FixtureAcceptanceTransport implements AcceptanceTransport {
  readonly id = "fixture-non-model";
  readonly sendsLiveModelMessages = false;

  async runTwoTurnContract(): Promise<AcceptanceConversation> {
    return {
      conversationId: "fixture-acceptance-conversation",
      firstResponse: TRANSPORT_TOKEN,
      secondResponse: TRANSPORT_TOKEN,
      sameSession: true,
      cabinetRestart: false,
    };
  }
}

export function selectTransport(): AcceptanceTransport {
  const selected = process.env.CABINET_ACCEPTANCE_TRANSPORT ?? "fixture";
  if (selected === "fixture") return new FixtureAcceptanceTransport();
  if (selected === "acp") return new LiveCabinetAcpTransport();
  throw new Error(
    `Acceptance transport "${selected}" is not registered. Refusing to improvise a live transport.`,
  );
}
