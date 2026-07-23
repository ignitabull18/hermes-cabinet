import { createHash } from "node:crypto";

export function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function makeFixture(overrides = {}) {
  const state = {
    schedules: new Map([
      [
        "job-1",
        {
          id: "job-1",
          profile: "default",
          name: "Daily inventory review",
          enabled: true,
          cadence: "0 9 * * *",
          payloadDigest: digest("fixture-payload"),
          revision: 4,
        },
      ],
    ]),
    executions: new Map(),
    runs: new Map([
      ["run-1", { id: "run-1", status: "running", updatedAt: 100 }],
    ]),
    clarifications: new Map([
      [
        "clarify-1",
        {
          id: "clarify-1",
          sessionId: "session-1",
          state: "pending",
          questionDigest: digest("fixture-question"),
        },
      ],
    ]),
    dispatchCount: 0,
    failAfterMutation: false,
    ...overrides,
  };

  return {
    state,
    readSchedule(id) {
      return structuredClone(state.schedules.get(id) ?? null);
    },
    readRun(id) {
      return structuredClone(state.runs.get(id) ?? null);
    },
    readClarification(id) {
      return structuredClone(state.clarifications.get(id) ?? null);
    },
    readExecution(id) {
      return structuredClone(state.executions.get(id) ?? null);
    },
    dispatch(intent) {
      state.dispatchCount += 1;
      let result;

      if (intent.action === "create_schedule") {
        state.schedules.set(intent.targetId, {
          id: intent.targetId,
          profile: intent.profile,
          name: intent.name,
          enabled: true,
          cadence: intent.cadence,
          payloadDigest: intent.payloadDigest,
          revision: 1,
        });
        result = { scheduleId: intent.targetId };
      } else if (intent.action === "update_schedule") {
        const current = state.schedules.get(intent.targetId);
        const next = {
          ...current,
          ...intent.patch,
          revision: current.revision + 1,
        };
        state.schedules.set(intent.targetId, next);
        result = { scheduleId: intent.targetId };
      } else if (intent.action === "pause_schedule") {
        const current = state.schedules.get(intent.targetId);
        state.schedules.set(intent.targetId, {
          ...current,
          enabled: false,
          revision: current.revision + 1,
        });
        result = { scheduleId: intent.targetId };
      } else if (intent.action === "resume_schedule") {
        const current = state.schedules.get(intent.targetId);
        state.schedules.set(intent.targetId, {
          ...current,
          enabled: true,
          revision: current.revision + 1,
        });
        result = { scheduleId: intent.targetId };
      } else if (intent.action === "trigger_schedule") {
        const executionId = intent.executionId;
        state.executions.set(executionId, {
          id: executionId,
          jobId: intent.targetId,
          state: "claimed",
          correlationId: intent.correlationId,
        });
        result = { executionId };
      } else if (intent.action === "delete_schedule") {
        state.schedules.delete(intent.targetId);
        result = { scheduleId: intent.targetId };
      } else if (intent.action === "resolve_clarification") {
        const current = state.clarifications.get(intent.targetId);
        state.clarifications.set(intent.targetId, {
          ...current,
          state: "resolved",
          responseDigest: intent.responseDigest,
        });
        result = { clarificationId: intent.targetId };
      } else {
        throw new Error(`unsupported fixture action: ${intent.action}`);
      }

      if (state.failAfterMutation) {
        throw new Error("fixture transport lost after dispatch");
      }
      return result;
    },
  };
}
