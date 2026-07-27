import {
  AgentEventEnvelopeSchema,
  GlobalSnapshotSchema,
  ListProviderPreferencesResponseSchema,
  PreferencesResponseSchema,
  ProviderPreferenceResponseSchema,
  UpdatePreferencesRequestSchema,
  UpdateProviderPreferenceRequestSchema,
  type AgentEventEnvelope,
} from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import { CoreApiClient, CoreClientError, type CoreFetch } from "./core-client.js";

const TOKEN = "A".repeat(43);
const connection = { instanceId: "instance:web", port: 41_337, token: TOKEN };

function event(seq: number): AgentEventEnvelope {
  return AgentEventEnvelopeSchema.parse({
    event: { state: "idle", type: "session_state" },
    eventId: `event:${seq}`,
    occurredAt: "2026-07-24T08:00:00.000Z",
    seq,
    sessionId: "session:web",
    turnId: null,
    v: 1,
  });
}

const emptySnapshot = GlobalSnapshotSchema.parse({
  activeTurns: [],
  includedSessions: [],
  pendingApprovals: [],
  sessions: [],
  snapshotSeq: 0,
});

describe("CoreApiClient", () => {
  it("keeps the bearer out of URLs and validates successful JSON at runtime", async () => {
    const requests: Array<{ readonly init: RequestInit | undefined; readonly url: string }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json(emptySnapshot);
    };
    const client = new CoreApiClient(connection, fakeFetch);
    await expect(client.getGlobalSnapshot(["session one"])).resolves.toEqual(emptySnapshot);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("includeSessionId=session+one");
    expect(requests[0]?.url).not.toContain(TOKEN);
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("gets preferences with an authenticated GET without putting the bearer in the URL", async () => {
    const preferences = PreferencesResponseSchema.parse({
      conversationDirectory: "/Users/example/Documents/Dogoos",
    });
    const requests: Array<{ readonly init: RequestInit | undefined; readonly url: string }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json(preferences);
    };
    const client = new CoreApiClient(connection, fakeFetch);

    await expect(client.getPreferences()).resolves.toEqual(preferences);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:41337/api/preferences");
    expect(requests[0]?.url).not.toContain(TOKEN);
    expect(requests[0]?.init?.method ?? "GET").toBe("GET");
    expect(requests[0]?.init?.body).toBeUndefined();
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("posts the strict preferences JSON body and parses the response schema", async () => {
    const update = UpdatePreferencesRequestSchema.parse({
      conversationDirectory: "/Users/example/Workspace/Chats",
    });
    const preferences = PreferencesResponseSchema.parse({
      conversationDirectory: update.conversationDirectory,
    });
    const requests: Array<{ readonly init: RequestInit | undefined; readonly url: string }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json(preferences);
    };
    const client = new CoreApiClient(connection, fakeFetch);

    await expect(client.updatePreferences(update)).resolves.toEqual(preferences);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:41337/api/preferences");
    expect(requests[0]?.url).not.toContain(TOKEN);
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({ conversationDirectory: "/Users/example/Workspace/Chats" }),
    );
  });

  it("loads and updates provider preferences with authenticated strict requests", async () => {
    const update = UpdateProviderPreferenceRequestSchema.parse({
      permissionProfileId: "agent-full-access",
      visibleInSidebar: false,
    });
    const list = ListProviderPreferencesResponseSchema.parse({
      preferences: [{ ...update, providerId: "cursor-agent" }],
    });
    const updated = ProviderPreferenceResponseSchema.parse({
      preference: { ...update, providerId: "cursor-agent" },
    });
    const requests: Array<{ readonly init: RequestInit | undefined; readonly url: string }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json((init?.method ?? "GET") === "PUT" ? updated : list);
    };
    const client = new CoreApiClient(connection, fakeFetch);

    await expect(client.listProviderPreferences()).resolves.toEqual(list);
    await expect(client.updateProviderPreference("cursor-agent", update)).resolves.toEqual(updated);

    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:41337/api/provider-preferences",
      "http://127.0.0.1:41337/api/provider-preferences/cursor-agent",
    ]);
    expect(requests[1]?.init?.method).toBe("PUT");
    expect(requests[1]?.init?.body).toBe(JSON.stringify(update));
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("returns a safe structured error without leaking credentials", async () => {
    const client = new CoreApiClient(connection, async () =>
      Response.json(
        {
          activeTurnId: "turn:active",
          code: "SESSION_BUSY",
          message: "Session already has an active Turn",
          retryable: true,
          sessionId: "session:web",
        },
        { status: 409 },
      ),
    );
    const request = client.createTurn("session:web", {
      clientRequestId: "request:web",
      content: [{ text: "hello", type: "text" }],
    });
    await expect(request).rejects.toMatchObject({
      code: "SESSION_BUSY",
      message: "Session already has an active Turn",
      retryable: true,
      status: 409,
    });
    await request.catch((error: unknown) => {
      expect(error).toBeInstanceOf(CoreClientError);
      expect(String(error)).not.toContain(TOKEN);
    });
  });

  it("parses split fetch-SSE frames, ignores heartbeat, and verifies id equals seq", async () => {
    const first = event(1);
    const wire = `: heartbeat\n\nid: 1\ndata: ${JSON.stringify(first)}\n\n`;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(wire.slice(0, 17)));
        controller.enqueue(encoder.encode(wire.slice(17)));
        controller.close();
      },
    });
    const client = new CoreApiClient(connection, async () => {
      return new Response(body, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    });
    const received: AgentEventEnvelope[] = [];
    for await (const envelope of client.events(0)) received.push(envelope);
    expect(received).toEqual([first]);
  });

  it("rejects a mismatched SSE id as a retryable protocol failure", async () => {
    const first = event(1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`id: 2\ndata: ${JSON.stringify(first)}\n\n`));
        controller.close();
      },
    });
    const client = new CoreApiClient(connection, async () => {
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const consume = async () => {
      await client.events(0).next();
    };
    await expect(consume()).rejects.toMatchObject({
      code: "CORE_PROTOCOL_ERROR",
      retryable: true,
    });
  });
});
