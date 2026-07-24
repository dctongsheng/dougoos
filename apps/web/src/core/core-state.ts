import type {
  AgentEventEnvelope,
  ApprovalOption,
  ApprovalSnapshot,
  GlobalSnapshot,
  MessageSnapshot,
  SessionSnapshot,
  SessionSummary,
  TurnSnapshot,
  TurnStatus,
} from "@dougoos/shared";
import { CONTRACT_LIMITS, normalizeSingleLinePreview } from "@dougoos/shared";

export type LiveMessage =
  | {
      readonly body: string;
      readonly id: string;
      readonly kind: "note" | "text" | "think" | "user";
      readonly state?: "complete" | "streaming";
    }
  | {
      readonly displayInput: string;
      readonly id: string;
      readonly kind: "tool";
      readonly result: string;
      readonly status: "cancelled" | "done" | "error" | "pending" | "running";
      readonly title: string;
      readonly toolCallId: string;
    }
  | {
      readonly id: string;
      readonly kind: "diff";
      readonly newText: string;
      readonly oldText: string | null;
      readonly path: string;
    }
  | {
      readonly description: string;
      readonly id: string;
      readonly kind: "approval";
      readonly options: readonly ApprovalOption[];
      readonly requestId: string;
      readonly status: "allowed" | "cancelled" | "expired" | "pending" | "rejected";
      readonly title: string;
      readonly turnId?: string;
    };

export interface LiveTurn {
  readonly id: string;
  readonly sessionId: string;
  readonly status: TurnStatus;
}

export interface LiveApproval {
  readonly description: string;
  readonly id: string;
  readonly options: readonly ApprovalOption[];
  readonly requestId: string;
  readonly sessionId: string;
  readonly status: "allowed" | "cancelled" | "expired" | "pending" | "rejected";
  readonly title: string;
  readonly turnId: string;
}

export interface LiveSession {
  readonly approvals: readonly LiveApproval[];
  readonly id: string;
  readonly messages: readonly LiveMessage[];
  readonly turns: readonly LiveTurn[];
}

export interface CoreViewState {
  readonly activeTurns: Readonly<Record<string, LiveTurn>>;
  readonly lastAppliedSeq: number;
  readonly localBuffers: Readonly<Record<string, readonly AgentEventEnvelope[]>>;
  readonly pendingApprovals: Readonly<Record<string, LiveApproval>>;
  readonly seenEventIds: ReadonlySet<string>;
  readonly sessions: Readonly<Record<string, LiveSession>>;
  readonly summaries: Readonly<Record<string, SessionSummary>>;
  readonly terminalTurnIds: ReadonlySet<string>;
}

export type ApplyEnvelopeResult =
  | { readonly kind: "applied"; readonly state: CoreViewState }
  | {
      readonly kind: "ignored";
      readonly reason: "duplicate" | "old";
      readonly state: CoreViewState;
    }
  | {
      readonly expectedSeq: number;
      readonly kind: "gap";
      readonly receivedSeq: number;
      readonly state: CoreViewState;
    }
  | {
      readonly kind: "snapshot-required";
      readonly sessionId: string;
      readonly state: CoreViewState;
    };

const approvalKey = (turnId: string, requestId: string): string => `${turnId}\u0000${requestId}`;

function omitRecordEntries<T>(
  record: Readonly<Record<string, T>>,
  omit: (key: string, value: T) => boolean,
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => !omit(key, value)));
}

function messageFromSnapshot(message: MessageSnapshot): LiveMessage {
  switch (message.kind) {
    case "user":
      return { body: message.body, id: message.id, kind: "user" };
    case "text":
    case "think":
      return {
        body: message.body,
        id: message.id,
        kind: message.kind,
        state: message.state,
      };
    case "note":
      return { body: message.body, id: message.id, kind: "note" };
    case "tool":
      return {
        displayInput: message.displayInput ?? "",
        id: message.id,
        kind: "tool",
        result:
          message.result?.type === "inline"
            ? message.result.output
            : message.result?.type === "artifact"
              ? message.result.artifact.displayName
              : "",
        status: message.status,
        title: message.title,
        toolCallId: message.toolCallId,
      };
    case "diff":
      return message.diff.type === "inline"
        ? {
            id: message.id,
            kind: "diff",
            newText: message.diff.newText,
            oldText: message.diff.oldText,
            path: message.diff.path,
          }
        : {
            id: message.id,
            kind: "diff",
            newText: `Artifact: ${message.diff.artifact.displayName}`,
            oldText: null,
            path: message.diff.path,
          };
    case "approval":
      return {
        description: message.description ?? "",
        id: message.id,
        kind: "approval",
        options: [],
        requestId: message.requestId,
        status: "pending",
        title: "Permission request",
      };
  }
}

function approvalFromSnapshot(approval: ApprovalSnapshot): LiveApproval {
  return {
    description: approval.description ?? "",
    id: approval.id,
    options: approval.options,
    requestId: approval.requestId,
    sessionId: approval.sessionId,
    status: approval.status,
    title: approval.title,
    turnId: approval.turnId,
  };
}

function turnFromSnapshot(turn: TurnSnapshot): LiveTurn {
  return { id: turn.id, sessionId: turn.sessionId, status: turn.status };
}

function sessionFromSnapshot(snapshot: SessionSnapshot): LiveSession {
  const approvals = snapshot.approvals.map(approvalFromSnapshot);
  const approvalByRequest = new Map(approvals.map((approval) => [approval.requestId, approval]));
  return {
    approvals,
    id: snapshot.session.id,
    messages: snapshot.messages.map((message) => {
      const mapped = messageFromSnapshot(message);
      if (mapped.kind !== "approval") return mapped;
      const approval = approvalByRequest.get(mapped.requestId);
      return approval === undefined
        ? mapped
        : {
            ...mapped,
            description: approval.description,
            options: approval.options,
            status: approval.status,
            title: approval.title,
            turnId: approval.turnId,
          };
    }),
    turns: snapshot.turns.map(turnFromSnapshot),
  };
}

export function stateFromGlobalSnapshot(snapshot: GlobalSnapshot): CoreViewState {
  const activeTurns = Object.fromEntries(
    snapshot.activeTurns.map((turn) => [turn.id, turnFromSnapshot(turn)]),
  );
  const pendingApprovals = Object.fromEntries(
    snapshot.pendingApprovals.map((approval) => [
      approvalKey(approval.turnId, approval.requestId),
      approvalFromSnapshot(approval),
    ]),
  );
  const sessions = Object.fromEntries(
    snapshot.includedSessions.map((session) => [session.session.id, sessionFromSnapshot(session)]),
  );
  const summaries = Object.fromEntries(snapshot.sessions.map((summary) => [summary.id, summary]));
  const terminalTurnIds = new Set(
    snapshot.includedSessions.flatMap((session) =>
      session.turns.filter((turn) => !Object.hasOwn(activeTurns, turn.id)).map((turn) => turn.id),
    ),
  );
  return {
    activeTurns,
    lastAppliedSeq: snapshot.snapshotSeq,
    localBuffers: {},
    pendingApprovals,
    seenEventIds: new Set(),
    sessions,
    summaries,
    terminalTurnIds,
  };
}

function replaceMessage(
  messages: readonly LiveMessage[],
  id: string,
  update: (message: LiveMessage | undefined) => LiveMessage,
): readonly LiveMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return [...messages, update(undefined)];
  const next = [...messages];
  next[index] = update(messages[index]);
  return next;
}

function applyToSession(
  session: LiveSession,
  envelope: AgentEventEnvelope,
  terminalTurnIds: ReadonlySet<string>,
): LiveSession {
  const event = envelope.event;
  const turnId = envelope.turnId;
  const isLateTerminalEvent =
    turnId !== null &&
    terminalTurnIds.has(turnId) &&
    event.type !== "turn_end" &&
    event.type !== "session_state" &&
    event.type !== "session_error";
  if (isLateTerminalEvent) return session;

  switch (event.type) {
    case "user_message":
      return {
        ...session,
        messages: replaceMessage(session.messages, event.messageId, () => ({
          body: event.body,
          id: event.messageId,
          kind: "user",
        })),
      };
    case "message_delta":
    case "thought_delta": {
      const kind = event.type === "message_delta" ? "text" : "think";
      return {
        ...session,
        messages: replaceMessage(session.messages, event.messageId, (current) => ({
          body: current?.kind === kind ? `${current.body}${event.text}` : event.text,
          id: event.messageId,
          kind,
          state: "streaming",
        })),
      };
    }
    case "note":
      return {
        ...session,
        messages: replaceMessage(session.messages, event.messageId, () => ({
          body: event.text,
          id: event.messageId,
          kind: "note",
        })),
      };
    case "tool_call": {
      const id = `tool:${turnId ?? "none"}:${event.toolCallId}`;
      return {
        ...session,
        messages: replaceMessage(session.messages, id, (current) => ({
          displayInput:
            current?.kind === "tool" ? current.displayInput : (event.displayInput ?? ""),
          id,
          kind: "tool",
          result: current?.kind === "tool" ? current.result : "",
          status: event.status,
          title: event.title,
          toolCallId: event.toolCallId,
        })),
      };
    }
    case "tool_update":
      return {
        ...session,
        messages: session.messages.map((message) =>
          message.kind === "tool" && message.toolCallId === event.toolCallId
            ? {
                ...message,
                result:
                  event.result?.type === "inline"
                    ? event.result.output
                    : event.result?.type === "artifact"
                      ? event.result.artifact.displayName
                      : message.result,
                status: event.status,
              }
            : message,
        ),
      };
    case "diff": {
      return {
        ...session,
        messages: replaceMessage(session.messages, event.messageId, () =>
          event.diff.type === "inline"
            ? {
                id: event.messageId,
                kind: "diff",
                newText: event.diff.newText,
                oldText: event.diff.oldText,
                path: event.diff.path,
              }
            : {
                id: event.messageId,
                kind: "diff",
                newText: `Artifact: ${event.diff.artifact.displayName}`,
                oldText: null,
                path: event.diff.path,
              },
        ),
      };
    }
    case "approval_request": {
      const id = `approval:${turnId ?? "none"}:${event.requestId}`;
      const approval: LiveApproval = {
        description: event.description ?? "",
        id,
        options: event.options,
        requestId: event.requestId,
        sessionId: envelope.sessionId,
        status: "pending",
        title: event.title,
        turnId: turnId ?? "none",
      };
      return {
        ...session,
        approvals: [
          ...session.approvals.filter((candidate) => candidate.requestId !== event.requestId),
          approval,
        ],
        messages: replaceMessage(session.messages, id, () => ({
          description: approval.description,
          id,
          kind: "approval",
          options: approval.options,
          requestId: approval.requestId,
          status: approval.status,
          title: approval.title,
          turnId: approval.turnId,
        })),
      };
    }
    case "approval_resolved":
      return {
        ...session,
        approvals: session.approvals.map((approval) =>
          approval.requestId === event.requestId ? { ...approval, status: event.status } : approval,
        ),
        messages: session.messages.map((message) =>
          message.kind === "approval" && message.requestId === event.requestId
            ? { ...message, status: event.status }
            : message,
        ),
      };
    case "turn_state": {
      if (turnId === null) return session;
      const turn: LiveTurn = {
        id: turnId,
        sessionId: envelope.sessionId,
        status: event.status,
      };
      return {
        ...session,
        turns: [...session.turns.filter((candidate) => candidate.id !== turnId), turn],
      };
    }
    case "turn_end": {
      if (turnId === null) return session;
      const status = event.status;
      return {
        ...session,
        approvals: session.approvals.map((approval) =>
          approval.turnId === turnId && approval.status === "pending"
            ? { ...approval, status: "cancelled" }
            : approval,
        ),
        messages: session.messages.map((message) => {
          if (message.kind === "text" || message.kind === "think") {
            return { ...message, state: "complete" };
          }
          if (
            message.kind === "tool" &&
            (message.status === "pending" || message.status === "running")
          ) {
            return {
              ...message,
              status:
                status === "completed"
                  ? ("done" as const)
                  : status === "failed"
                    ? ("error" as const)
                    : ("cancelled" as const),
            };
          }
          if (message.kind === "approval" && message.status === "pending") {
            return { ...message, status: "cancelled" as const };
          }
          return message;
        }),
        turns: session.turns.map((turn) => (turn.id === turnId ? { ...turn, status } : turn)),
      };
    }
    case "session_error":
    case "session_state":
      return session;
  }
}

function summaryStateForEvent(
  current: SessionSummary,
  envelope: AgentEventEnvelope,
): SessionSummary {
  const event = envelope.event;
  const updatedAt =
    Date.parse(envelope.occurredAt) > Date.parse(current.updatedAt)
      ? envelope.occurredAt
      : current.updatedAt;
  switch (event.type) {
    case "session_state":
      return { ...current, state: event.state, updatedAt };
    case "session_error":
      return { ...current, activeTurnId: null, state: "crashed", updatedAt };
    case "turn_state":
      return {
        ...current,
        activeTurnId: envelope.turnId,
        state:
          event.status === "running"
            ? "running"
            : event.status === "awaiting_approval"
              ? "awaiting_approval"
              : event.status === "cancelling"
                ? "cancelling"
                : "idle",
        updatedAt,
      };
    case "turn_end":
      return {
        ...current,
        activeTurnId: null,
        state: event.status === "interrupted" ? "crashed" : "idle",
        updatedAt,
      };
    case "message_delta":
      return { ...current, lastMessagePreview: event.text, updatedAt };
    case "thought_delta":
      return { ...current, updatedAt };
    case "note":
      return { ...current, lastMessagePreview: event.text, updatedAt };
    case "user_message":
      return {
        ...current,
        ...(current.firstUserMessagePreview === undefined
          ? {
              firstUserMessagePreview: normalizeSingleLinePreview(
                event.body,
                CONTRACT_LIMITS.titleChars,
              ),
            }
          : {}),
        lastMessagePreview: event.body,
        updatedAt,
      };
    default:
      return { ...current, updatedAt };
  }
}

function applyKnownEnvelope(state: CoreViewState, envelope: AgentEventEnvelope): CoreViewState {
  const summary = state.summaries[envelope.sessionId];
  if (summary === undefined) return state;

  const event = envelope.event;
  const turnId = envelope.turnId;
  let activeTurns = { ...state.activeTurns };
  let pendingApprovals = { ...state.pendingApprovals };
  const terminalTurnIds = new Set(state.terminalTurnIds);

  if (event.type === "turn_state" && turnId !== null) {
    activeTurns[turnId] = {
      id: turnId,
      sessionId: envelope.sessionId,
      status: event.status,
    };
  } else if (event.type === "turn_end" && turnId !== null) {
    activeTurns = omitRecordEntries(activeTurns, (key) => key === turnId);
    terminalTurnIds.add(turnId);
    pendingApprovals = omitRecordEntries(
      pendingApprovals,
      (_key, approval) => approval.turnId === turnId,
    );
  } else if (event.type === "approval_request" && turnId !== null) {
    const approval: LiveApproval = {
      description: event.description ?? "",
      id: `approval:${turnId}:${event.requestId}`,
      options: event.options,
      requestId: event.requestId,
      sessionId: envelope.sessionId,
      status: "pending",
      title: event.title,
      turnId,
    };
    pendingApprovals[approvalKey(turnId, event.requestId)] = approval;
  } else if (event.type === "approval_resolved" && turnId !== null) {
    const resolvedKey = approvalKey(turnId, event.requestId);
    pendingApprovals = omitRecordEntries(pendingApprovals, (key) => key === resolvedKey);
  }

  const currentSession = state.sessions[envelope.sessionId];
  const sessions =
    currentSession === undefined
      ? state.sessions
      : {
          ...state.sessions,
          [envelope.sessionId]: applyToSession(currentSession, envelope, state.terminalTurnIds),
        };
  const currentBuffer = state.localBuffers[envelope.sessionId];
  const localBuffers =
    currentBuffer === undefined
      ? state.localBuffers
      : {
          ...state.localBuffers,
          [envelope.sessionId]: [...currentBuffer, envelope],
        };

  return {
    ...state,
    activeTurns,
    lastAppliedSeq: envelope.seq,
    localBuffers,
    pendingApprovals,
    seenEventIds: new Set([...state.seenEventIds, envelope.eventId]),
    sessions,
    summaries: {
      ...state.summaries,
      [envelope.sessionId]: summaryStateForEvent(summary, envelope),
    },
    terminalTurnIds,
  };
}

export function applyEnvelope(
  state: CoreViewState,
  envelope: AgentEventEnvelope,
): ApplyEnvelopeResult {
  if (envelope.seq <= state.lastAppliedSeq) {
    return {
      kind: "ignored",
      reason: state.seenEventIds.has(envelope.eventId) ? "duplicate" : "old",
      state,
    };
  }
  const expectedSeq = state.lastAppliedSeq + 1;
  if (envelope.seq !== expectedSeq || state.seenEventIds.has(envelope.eventId)) {
    return { expectedSeq, kind: "gap", receivedSeq: envelope.seq, state };
  }
  if (state.summaries[envelope.sessionId] === undefined) {
    return { kind: "snapshot-required", sessionId: envelope.sessionId, state };
  }
  if (
    envelope.turnId !== null &&
    state.sessions[envelope.sessionId] === undefined &&
    state.localBuffers[envelope.sessionId] === undefined
  ) {
    return { kind: "snapshot-required", sessionId: envelope.sessionId, state };
  }
  return { kind: "applied", state: applyKnownEnvelope(state, envelope) };
}

export function beginLocalSessionLoad(state: CoreViewState, sessionId: string): CoreViewState {
  return {
    ...state,
    localBuffers: { ...state.localBuffers, [sessionId]: [] },
  };
}

export function completeLocalSessionLoad(
  state: CoreViewState,
  snapshot: SessionSnapshot,
): CoreViewState {
  const sessionId = snapshot.session.id;
  const buffered = state.localBuffers[sessionId] ?? [];
  let session = sessionFromSnapshot(snapshot);
  for (const envelope of buffered) {
    if (envelope.seq > snapshot.sessionSnapshotSeq) {
      session = applyToSession(session, envelope, state.terminalTurnIds);
    }
  }
  const localBuffers = omitRecordEntries(state.localBuffers, (key) => key === sessionId);
  return {
    ...state,
    localBuffers,
    sessions: { ...state.sessions, [sessionId]: session },
  };
}
