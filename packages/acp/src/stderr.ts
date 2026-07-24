import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

import { redactDiagnosticText } from "@dougoos/shared";

import type { AgentStderrLogEntry } from "./types.js";

export const DEFAULT_AGENT_STDERR_BYTE_LIMIT = 64 * 1_024;
const MAX_STDERR_ENTRY_CODE_POINTS = 4_096;

export function redactAgentStderrText(value: string): string {
  const redacted = redactDiagnosticText(value).replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    "[REDACTED EMAIL]",
  );
  const normalized = Array.from(redacted)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, MAX_STDERR_ENTRY_CODE_POINTS).join("");
}

interface ObserveAgentStderrOptions {
  readonly byteLimit?: number;
  readonly clock: () => string;
  readonly onEntry?: (entry: AgentStderrLogEntry) => void;
  readonly providerId: string;
  readonly sessionId: string;
}

export function observeAgentStderr(stream: Readable, options: ObserveAgentStderrOptions): void {
  const byteLimit = options.byteLimit ?? DEFAULT_AGENT_STDERR_BYTE_LIMIT;
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) {
    throw new TypeError("stderrByteLimit must be a positive safe integer");
  }
  const decoder = new StringDecoder("utf8");
  let bytesRead = 0;
  let pending = "";
  let truncated = false;
  let decoderEnded = false;

  const emit = (value: string, wasTruncated: boolean): void => {
    const text = redactAgentStderrText(value);
    if (text.length === 0) return;
    try {
      options.onEntry?.({
        occurredAt: new Date(options.clock()).toISOString(),
        providerId: options.providerId,
        sessionId: options.sessionId,
        text,
        truncated: wasTruncated,
      });
    } catch {
      // Local diagnostics are best effort and never control the ACP lifecycle.
    }
  };
  const flushPending = (): void => {
    if (pending.length > 0) emit(pending, false);
    pending = "";
  };
  const endDecoder = (): void => {
    if (decoderEnded) return;
    decoderEnded = true;
    pending += decoder.end();
  };
  const emitTruncation = (): void => {
    if (truncated) return;
    truncated = true;
    endDecoder();
    flushPending();
    emit(`Agent stderr exceeded the ${String(byteLimit)} byte local log limit.`, true);
  };
  const flushLines = (): void => {
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      emit(pending.slice(0, newline), false);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  };

  stream.on("data", (value: Buffer | string) => {
    if (truncated) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = byteLimit - bytesRead;
    const accepted = chunk.subarray(0, Math.max(0, remaining));
    bytesRead += accepted.length;
    pending += decoder.write(accepted);
    flushLines();
    if (accepted.length < chunk.length || bytesRead >= byteLimit) emitTruncation();
  });
  stream.once("end", () => {
    if (!truncated) {
      endDecoder();
      flushPending();
    }
  });
}
