import { createHash, randomUUID } from "node:crypto";

import type { SessionUpdate, ToolCallContent, ToolKind } from "@agentclientprotocol/sdk";
import {
  AgentUiEventSchema,
  BoundedJsonValueSchema,
  CONTRACT_LIMITS,
  MessageIdSchema,
  OpaqueIdSchema,
  type AgentUiEvent,
  type ToolKind as NormalizedToolKind,
} from "@dougoos/shared";

import type { NormalizationContext } from "./types.js";

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function normalizedId(
  value: string | null | undefined,
  prefix: string,
  schema: typeof MessageIdSchema | typeof OpaqueIdSchema,
): string {
  if (value !== null && value !== undefined && schema.safeParse(value).success) return value;
  const source = value ?? randomUUID();
  const digest = createHash("sha256").update(source).digest("hex");
  return `${prefix}-${digest}`;
}

function mapToolKind(kind: ToolKind | null | undefined): NormalizedToolKind {
  switch (kind) {
    case "delete":
      return "delete";
    case "edit":
    case "move":
      return "edit";
    case "fetch":
      return "network";
    case "read":
      return "read";
    case "search":
      return "search";
    case "execute":
      return "shell";
    default:
      return "other";
  }
}

function stringifyBounded(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value === "string") {
      return value.length === 0 ? undefined : truncate(value, CONTRACT_LIMITS.toolOutputChars);
    }
    const bounded = BoundedJsonValueSchema.safeParse(value);
    if (!bounded.success) return undefined;
    const serialized = JSON.stringify(bounded.data);
    if (serialized === undefined || serialized.length === 0) return undefined;
    return truncate(serialized, CONTRACT_LIMITS.toolOutputChars);
  } catch {
    return undefined;
  }
}

function textFromToolContent(
  content: readonly ToolCallContent[] | null | undefined,
): string | undefined {
  if (content === null || content === undefined) return undefined;
  let text = "";
  for (const item of content) {
    if (item.type !== "content" || item.content.type !== "text") continue;
    const separator = text.length === 0 ? "" : "\n";
    const remaining = CONTRACT_LIMITS.toolOutputChars - text.length;
    if (remaining <= 0) break;
    text += `${separator}${item.content.text}`.slice(0, remaining);
  }
  return text.length === 0 ? undefined : truncate(text, CONTRACT_LIMITS.toolOutputChars);
}

function diffEvents(content: readonly ToolCallContent[] | null | undefined): AgentUiEvent[] {
  if (content === null || content === undefined) return [];
  const events: AgentUiEvent[] = [];
  for (const item of content) {
    if (item.type !== "diff") continue;
    const candidate = AgentUiEventSchema.safeParse({
      diff: {
        newText: item.newText,
        oldText: item.oldText ?? null,
        path: item.path,
        type: "inline",
      },
      messageId: normalizedId(
        `${item.path}:${item.oldText ?? ""}:${item.newText}`,
        "acp-diff",
        MessageIdSchema,
      ),
      type: "diff",
    });
    // Artifact persistence belongs to Core. Oversized/invalid inline diffs are
    // intentionally omitted here instead of leaking an unbounded raw payload.
    if (candidate.success) events.push(candidate.data);
  }
  return events;
}

function parseEvents(events: readonly unknown[]): AgentUiEvent[] {
  return events.map((event) => AgentUiEventSchema.parse(event));
}

export function normalizeSessionUpdate(
  update: SessionUpdate,
  context: NormalizationContext,
): readonly AgentUiEvent[] {
  const providerEvents = context.provider.normalizeMeta?.(update);
  if (providerEvents !== undefined && providerEvents !== null) return parseEvents(providerEvents);

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      if (update.content.type !== "text" || update.content.text.length === 0) return [];
      return parseEvents([
        {
          messageId: normalizedId(
            update.messageId ?? context.messageId("message"),
            "acp-message",
            MessageIdSchema,
          ),
          text: truncate(update.content.text, CONTRACT_LIMITS.messageBodyChars),
          type: "message_delta",
        },
      ]);
    }
    case "agent_thought_chunk": {
      if (update.content.type !== "text" || update.content.text.length === 0) return [];
      return parseEvents([
        {
          messageId: normalizedId(
            update.messageId ?? context.messageId("thought"),
            "acp-thought",
            MessageIdSchema,
          ),
          text: truncate(update.content.text, CONTRACT_LIMITS.messageBodyChars),
          type: "thought_delta",
        },
      ]);
    }
    case "tool_call": {
      const toolCallId = normalizedId(update.toolCallId, "acp-tool", OpaqueIdSchema);
      const initial = {
        ...(stringifyBounded(update.rawInput) === undefined
          ? {}
          : { displayInput: stringifyBounded(update.rawInput) }),
        kind: mapToolKind(update.kind),
        status: update.status === "pending" ? "pending" : "running",
        title: truncate(update.title || "Agent tool", CONTRACT_LIMITS.titleChars),
        toolCallId,
        type: "tool_call",
      };
      const result = textFromToolContent(update.content) ?? stringifyBounded(update.rawOutput);
      const terminal =
        update.status === "completed" || update.status === "failed"
          ? [
              {
                ...(result === undefined ? {} : { result: { output: result, type: "inline" } }),
                status: update.status === "completed" ? "done" : "error",
                toolCallId,
                type: "tool_update",
              },
            ]
          : [];
      return parseEvents([initial, ...diffEvents(update.content), ...terminal]);
    }
    case "tool_call_update": {
      const toolCallId = normalizedId(update.toolCallId, "acp-tool", OpaqueIdSchema);
      const result = textFromToolContent(update.content) ?? stringifyBounded(update.rawOutput);
      const status =
        update.status === "completed" ? "done" : update.status === "failed" ? "error" : "running";
      return parseEvents([
        ...diffEvents(update.content),
        {
          ...(result === undefined ? {} : { result: { output: result, type: "inline" } }),
          status,
          toolCallId,
          type: "tool_update",
        },
      ]);
    }
    case "plan": {
      let text = "";
      for (const entry of update.entries) {
        const line = `${entry.status === "completed" ? "✓" : "•"} ${entry.content}`;
        const separator = text.length === 0 ? "" : "\n";
        const remaining = CONTRACT_LIMITS.messageBodyChars - text.length;
        if (remaining <= 0) break;
        text += `${separator}${line}`.slice(0, remaining);
      }
      if (text.length === 0) return [];
      return parseEvents([
        {
          level: "info",
          messageId: normalizedId(context.messageId("note"), "acp-note", MessageIdSchema),
          text: truncate(text, CONTRACT_LIMITS.messageBodyChars),
          type: "note",
        },
      ]);
    }
    case "available_commands_update":
    case "config_option_update":
    case "current_mode_update":
    case "plan_removed":
    case "plan_update":
    case "session_info_update":
    case "usage_update":
    case "user_message_chunk":
      return [];
  }
}
