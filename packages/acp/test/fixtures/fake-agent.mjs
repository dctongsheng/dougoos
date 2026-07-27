#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { setTimeout } from "node:timers";

import {
  PROTOCOL_VERSION,
  RequestError,
  agent,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

let authenticated = false;
let nextSession = 0;
const sessions = new Map();

if (process.env.DOUGOOS_FIXTURE_STDERR !== undefined) {
  process.stderr.write(`${process.env.DOUGOOS_FIXTURE_STDERR}\n`);
}

const childPidPath = process.env.DOUGOOS_FIXTURE_CHILD_PID_PATH;
if (childPidPath !== undefined) {
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
    stdio: "ignore",
  });
  if (descendant.pid !== undefined) {
    await writeFile(childPidPath, String(descendant.pid), "utf8");
  }
}

async function trace(value) {
  const path = process.env.DOUGOOS_FIXTURE_TRACE_PATH;
  if (path !== undefined) await appendFile(path, `${value}\n`, "utf8");
}

const application = agent({ name: "dougoos-test-agent" })
  .onRequest(methods.agent.initialize, () => ({
    agentCapabilities: {
      promptCapabilities: { image: true },
      sessionCapabilities: { close: {} },
    },
    agentInfo: { name: "fixture-agent", version: "1.0.0" },
    authMethods: [{ id: "fixture-auth", name: "Fixture authentication" }],
    protocolVersion: PROTOCOL_VERSION,
  }))
  .onRequest(methods.agent.authenticate, async ({ params }) => {
    if (params.methodId !== "fixture-auth") throw new Error("unsupported fixture auth");
    authenticated = true;
    await trace("authenticated");
    return {};
  })
  .onRequest(methods.agent.session.new, async () => {
    if (process.env.DOUGOOS_FIXTURE_REQUIRE_AUTH === "1" && !authenticated) {
      throw RequestError.authRequired();
    }
    if (!authenticated) throw new Error("fixture is not authenticated");
    const sessionId = `fixture-session-${String(++nextSession)}`;
    sessions.set(sessionId, {
      cancel: undefined,
      cancelRequested: false,
      modeId: "default",
      safeToggle: false,
    });
    await trace("new_session");
    return {
      configOptions: [
        {
          currentValue: false,
          description: "Fixture boolean permission option",
          id: "safe_toggle",
          name: "Safe toggle",
          type: "boolean",
        },
      ],
      modes: {
        availableModes: [
          { description: "Fixture default", id: "default", name: "Default" },
          { description: "Fixture automatic", id: "auto", name: "Auto" },
        ],
        currentModeId: "default",
      },
      sessionId,
    };
  })
  .onRequest(methods.agent.session.setMode, async ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw new Error("fixture session not found");
    if (!["default", "auto"].includes(params.modeId)) {
      throw new Error("unsupported fixture mode");
    }
    session.modeId = params.modeId;
    await trace(`set_mode:${params.modeId}`);
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, async ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw new Error("fixture session not found");
    if (params.configId !== "safe_toggle" || typeof params.value !== "boolean") {
      throw new Error("unsupported fixture config option");
    }
    session.safeToggle = params.value;
    await trace(`set_config:safe_toggle:${String(params.value)}`);
    return {
      configOptions: [
        {
          currentValue: session.safeToggle,
          description: "Fixture boolean permission option",
          id: "safe_toggle",
          name: "Safe toggle",
          type: "boolean",
        },
      ],
    };
  })
  .onRequest(methods.agent.session.close, ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .onRequest(methods.agent.session.prompt, async ({ client, params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) throw new Error("fixture session not found");
    const text = params.prompt
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    await trace(`prompt:${text}`);

    if (text.includes("[exit]")) {
      setTimeout(() => process.exit(17), 10);
      return await new Promise(() => undefined);
    }
    if (text.includes("[cancel]")) {
      if (session.cancelRequested) return { stopReason: "cancelled" };
      await new Promise((resolve) => {
        session.cancel = resolve;
      });
      return { stopReason: "cancelled" };
    }

    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        content: { text: "Hello ", type: "text" },
        messageId: "fixture-message",
        sessionUpdate: "agent_message_chunk",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        content: { text: "world", type: "text" },
        messageId: "fixture-message",
        sessionUpdate: "agent_message_chunk",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        content: { text: "thinking", type: "text" },
        messageId: "fixture-thought",
        sessionUpdate: "agent_thought_chunk",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        entries: [{ content: "Exercise fixture", priority: "high", status: "in_progress" }],
        sessionUpdate: "plan",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        kind: "edit",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "Edit fixture",
        toolCallId: "fixture-tool",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        content: [
          {
            newText: "after\n",
            oldText: "before\n",
            path: "/tmp/fixture.txt",
            type: "diff",
          },
        ],
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "fixture-tool",
      },
    });

    if (text.includes("[approval]")) {
      const permission = await client.request(methods.client.session.requestPermission, {
        options: text.includes("[approval-no-allow]")
          ? [{ kind: "reject_once", name: "Reject", optionId: "reject" }]
          : [
              { kind: "allow_once", name: "Allow once", optionId: "allow" },
              { kind: "reject_once", name: "Reject", optionId: "reject" },
            ],
        sessionId: params.sessionId,
        toolCall: {
          kind: "execute",
          status: "pending",
          title: "Run fixture command",
          toolCallId: "approval-tool",
        },
      });
      await trace(`permission:${permission.outcome.outcome}`);
    }
    return { stopReason: "end_turn" };
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session === undefined) return;
    session.cancelRequested = true;
    session.cancel?.();
  });

const transport = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
application.connect(transport);
