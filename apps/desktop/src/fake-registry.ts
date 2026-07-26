import { randomUUID } from "node:crypto";

import type {
  CancelRegistryTurnInput,
  CoreRegistry,
  CreateRegistrySessionInput,
  RegistryEventListener,
  ResolveRegistryApprovalInput,
  StartRegistryTurnInput,
} from "@dougoos/core";
import {
  AgentCliInstallationSchema,
  AgentRuntimeEventSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderSchema,
} from "@dougoos/shared";

const PROVIDER_ID = "test-fake";
const DEFAULT_STEP_DELAY_MS = 12;
const DELAYED_STEP_DELAY_MS = 200;
const TOOL_OVERFLOW_INPUT = `PI_CODING_AGENT=true
PI_ACP_PI_COMMAND=/fixture/bin/pi
PATH=/fixture/${"tool-input-without-breaks-".repeat(24)}
TOOL_INPUT_END`;
const TOOL_OVERFLOW_RESULT = `fixture output first line
${"tool-result-without-breaks-".repeat(24)}
fixture output last line
TOOL_RESULT_END`;

type ActiveTurnStatus = "awaiting_approval" | "cancelling" | "queued" | "running" | "starting";

interface FakeTurn {
  readonly responseMessageId: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolOverflow: boolean;
  status: ActiveTurnStatus | "terminal";
}

export interface FakeRegistryOptions {
  readonly clock?: () => string;
}

function capabilitySnapshot(negotiatedAt: string) {
  return ProviderCapabilitySnapshotSchema.parse({
    clientProxy: { config: false, fileSystem: false, terminal: false },
    negotiatedAt,
    permissionEnforcement: "requests_permission",
    protocolVersion: "1",
    session: { close: true, delete: false, list: false, load: false, resume: false },
    turn: { cancel: true, images: false, prompt: true },
  });
}

export class FakeRegistry implements CoreRegistry {
  readonly #clock: () => string;
  readonly #listeners = new Set<RegistryEventListener>();
  readonly #sessions = new Set<string>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #turns = new Map<string, FakeTurn>();

  #closed = false;

  constructor(options: FakeRegistryOptions = {}) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  cancelTurn(input: CancelRegistryTurnInput): "cancelled" | "cancelling" {
    const turn = this.#turns.get(input.turnId);
    if (turn === undefined || turn.sessionId !== input.sessionId || turn.status === "terminal") {
      return "cancelled";
    }
    if (turn.status === "cancelling") return "cancelling";
    if (turn.status === "queued") this.#transition(input.turnId, "starting");
    if (turn.status === "starting") this.#transition(input.turnId, "running");
    this.#transition(input.turnId, "cancelling");
    this.#schedule(DEFAULT_STEP_DELAY_MS, () => {
      const active = this.#turns.get(input.turnId);
      if (active?.status !== "cancelling") return;
      this.#emit(input.sessionId, input.turnId, {
        from: "cancelling",
        status: "cancelled",
        stopReason: "cancelled",
        type: "turn_end",
      });
      active.status = "terminal";
    });
    return "cancelling";
  }

  close(): void {
    this.#closed = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#turns.clear();
    this.#sessions.clear();
    this.#listeners.clear();
  }

  closeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    for (const [turnId, turn] of this.#turns) {
      if (turn.sessionId === sessionId) this.#turns.delete(turnId);
    }
  }

  createSession(input: CreateRegistrySessionInput) {
    if (input.providerId !== PROVIDER_ID) throw new Error("Test Fake Provider is unavailable");
    this.#sessions.add(input.sessionId);
    return {
      capabilities: capabilitySnapshot(this.#now()),
      providerSessionId: `fixture-${input.sessionId}`,
      title: "Fake Agent fixture",
    };
  }

  doctor(providerId: string) {
    const checkedAt = this.#now();
    if (providerId !== PROVIDER_ID) {
      return {
        checkedAt,
        providerId,
        reason: "Test Provider is not selected",
        remediation: "Select the explicit test-fake Provider",
        status: "unavailable" as const,
      };
    }
    return {
      capabilities: capabilitySnapshot(checkedAt),
      checkedAt,
      providerId,
      status: "available" as const,
      version: "fixture-1",
    };
  }

  initialize(): void {
    if (this.#closed) throw new Error("Test Fake Registry is closed");
  }

  listProviders() {
    const checkedAt = this.#now();
    return [
      ProviderSchema.parse({
        capabilities: capabilitySnapshot(checkedAt),
        checkedAt,
        displayName: "Test Fake Provider",
        id: PROVIDER_ID,
        processPolicy: { maxSessionsPerProcess: 64, multiSessionPerProcess: true },
        status: "available",
        version: "fixture-1",
      }),
    ];
  }

  listAgentCliInstallations() {
    const detectedAt = this.#now();
    return {
      checkedAt: detectedAt,
      clis: [
        AgentCliInstallationSchema.parse({
          command: "codex",
          detectedAt,
          displayName: "Codex",
          executablePath: "/fixture/bin/codex",
          integratedProviderId: "codex",
          version: "fixture-codex",
        }),
      ],
    };
  }

  onEvent(listener: RegistryEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  resolveApproval(input: ResolveRegistryApprovalInput): void {
    const turn = this.#turns.get(input.turnId);
    if (
      turn === undefined ||
      turn.sessionId !== input.sessionId ||
      turn.status !== "awaiting_approval"
    ) {
      throw new Error("Fake approval is not pending");
    }
    const rejected = input.optionId === "reject";
    if (input.optionId !== "allow-once" && !rejected) {
      throw new Error("Fake approval option is invalid");
    }
    this.#emit(input.sessionId, input.turnId, {
      decision: { optionId: input.optionId, type: "option" },
      requestId: input.requestId,
      status: rejected ? "rejected" : "allowed",
      type: "approval_resolved",
    });
    this.#transition(input.turnId, "running");
    this.#schedule(DEFAULT_STEP_DELAY_MS, () => {
      const active = this.#turns.get(input.turnId);
      if (active?.status !== "running") return;
      this.#emit(input.sessionId, input.turnId, {
        result: {
          output: rejected
            ? "Skipped by fixture decision"
            : active.toolOverflow
              ? TOOL_OVERFLOW_RESULT
              : "Fake command completed",
          type: "inline",
        },
        status: "done",
        toolCallId: active.toolCallId,
        type: "tool_update",
      });
      this.#emit(input.sessionId, input.turnId, {
        messageId: active.responseMessageId,
        text: rejected ? " Approval denied; continuing safely." : " Approval accepted; done.",
        type: "message_delta",
      });
      this.#emit(input.sessionId, input.turnId, {
        from: "running",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
        usage: {
          inputTokens: 8,
          outputTokens: 24,
          quality: "exact",
        },
      });
      active.status = "terminal";
    });
  }

  startTurn(input: StartRegistryTurnInput): void {
    if (!this.#sessions.has(input.sessionId)) throw new Error("Fake Session is unavailable");
    const prompt = input.request.content.map((part) => part.text).join("\n");
    const markdownResponse = prompt.includes("[fake:markdown]");
    const toolOverflow = prompt.includes("[fake:tool-overflow]");
    const stepDelay = prompt.includes("[fake:delayed]")
      ? DELAYED_STEP_DELAY_MS
      : DEFAULT_STEP_DELAY_MS;
    const turn: FakeTurn = {
      responseMessageId: randomUUID(),
      sessionId: input.sessionId,
      status: "queued",
      toolCallId: randomUUID(),
      toolOverflow,
    };
    this.#turns.set(input.turnId, turn);

    this.#schedule(stepDelay, () => this.#transitionIf(input.turnId, "queued", "starting"));
    this.#schedule(stepDelay * 2, () => this.#transitionIf(input.turnId, "starting", "running"));

    if (prompt.includes("[fake:crash]")) {
      this.#schedule(stepDelay * 3, () => {
        const active = this.#turns.get(input.turnId);
        if (active?.status !== "running") return;
        this.#emit(input.sessionId, input.turnId, {
          from: "running",
          status: "interrupted",
          stopReason: "interrupted",
          type: "turn_end",
        });
        active.status = "terminal";
        this.#emit(input.sessionId, null, {
          error: {
            code: "AGENT_PROCESS_CRASHED",
            details: { exitCode: 17, phase: "spawn" },
            message: "Agent process exited",
            retryable: true,
          },
          type: "session_error",
        });
      });
      return;
    }

    this.#schedule(stepDelay * 3, () => {
      if (!this.#isRunning(input.turnId)) return;
      this.#emit(input.sessionId, input.turnId, {
        messageId: randomUUID(),
        text: markdownResponse ? "PRIVATE_REASONING_SENTINEL" : "Inspecting the fixture plan…",
        type: "thought_delta",
      });
    });
    this.#schedule(stepDelay * 4, () => {
      if (!this.#isRunning(input.turnId)) return;
      this.#emit(input.sessionId, input.turnId, {
        messageId: turn.responseMessageId,
        text: markdownResponse
          ? "### Markdown 回归\n\n第一行\n第二行  \n硬换行\n\n- 条目一\n"
          : "Fake Agent streamed",
        type: "message_delta",
      });
    });
    this.#schedule(stepDelay * 5, () => {
      if (!this.#isRunning(input.turnId)) return;
      this.#emit(input.sessionId, input.turnId, {
        messageId: turn.responseMessageId,
        text: markdownResponse ? "- 条目二\n\n**粗体结论**" : " a response.",
        type: "message_delta",
      });
      this.#emit(input.sessionId, input.turnId, {
        level: "info",
        messageId: randomUUID(),
        text: "Fixture note",
        type: "note",
      });
    });
    this.#schedule(stepDelay * 6, () => {
      if (!this.#isRunning(input.turnId)) return;
      this.#emit(input.sessionId, input.turnId, {
        displayInput: toolOverflow ? TOOL_OVERFLOW_INPUT : "echo fixture",
        kind: "shell",
        status: "running",
        title: "Fake shell",
        toolCallId: turn.toolCallId,
        type: "tool_call",
      });
      this.#emit(input.sessionId, input.turnId, {
        diff: {
          newText: "after\n",
          oldText: "before\n",
          path: "fixture.txt",
          type: "inline",
        },
        messageId: randomUUID(),
        type: "diff",
      });
    });

    if (prompt.includes("[fake:cancel]")) return;

    this.#schedule(stepDelay * 7, () => {
      if (!this.#isRunning(input.turnId)) return;
      this.#transition(input.turnId, "awaiting_approval");
      this.#emit(input.sessionId, input.turnId, {
        description: "Exercise the explicit test-only approval path",
        expiresAt: new Date(Date.parse(this.#now()) + 5 * 60_000).toISOString(),
        options: [
          { kind: "allow", label: "Allow once", optionId: "allow-once" },
          { kind: "reject", label: "Reject", optionId: "reject" },
        ],
        requestId: `approval-${input.turnId}`,
        title: "Run fake command",
        type: "approval_request",
      });
    });
  }

  #emit(sessionId: string, turnId: string | null, event: unknown): void {
    if (this.#closed) return;
    const runtimeEvent = AgentRuntimeEventSchema.parse({
      event,
      occurredAt: this.#now(),
      sessionId,
      turnId,
    });
    for (const listener of this.#listeners) listener(runtimeEvent);
  }

  #isRunning(turnId: string): boolean {
    return this.#turns.get(turnId)?.status === "running";
  }

  #now(): string {
    return new Date(this.#clock()).toISOString();
  }

  #schedule(delayMs: number, action: () => void): void {
    if (this.#closed) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (!this.#closed) action();
    }, delayMs);
    this.#timers.add(timer);
  }

  #transition(turnId: string, status: ActiveTurnStatus): void {
    const turn = this.#turns.get(turnId);
    if (turn === undefined || turn.status === "terminal" || turn.status === status) return;
    const from = turn.status;
    turn.status = status;
    this.#emit(turn.sessionId, turnId, { from, status, type: "turn_state" });
  }

  #transitionIf(turnId: string, from: ActiveTurnStatus, status: ActiveTurnStatus): void {
    if (this.#turns.get(turnId)?.status === from) this.#transition(turnId, status);
  }
}
