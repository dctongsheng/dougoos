import {
  AgentEventEnvelopeSchema,
  CancelTurnResponseSchema,
  CreateSessionResponseSchema,
  CreateTurnResponseSchema,
  GlobalSnapshotSchema,
  HealthReadyResponseSchema,
  ListAgentCliInstallationsResponseSchema,
  ListProviderPreferencesResponseSchema,
  ListProvidersResponseSchema,
  PreferencesResponseSchema,
  ProviderDoctorResponseSchema,
  ProviderPreferenceResponseSchema,
  ResolveApprovalResponseSchema,
  RestErrorResponseSchema,
  SessionSnapshotSchema,
  type AgentEventEnvelope,
  type CancelTurnResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateTurnRequest,
  type CreateTurnResponse,
  type GlobalSnapshot,
  type HealthReadyResponse,
  type ListAgentCliInstallationsResponse,
  type ListProviderPreferencesResponse,
  type ListProvidersResponse,
  type PreferencesResponse,
  type ProviderDoctorResponse,
  type ProviderPreferenceResponse,
  type ResolveApprovalResponse,
  type RestErrorResponse,
  type SessionSnapshot,
  type UpdatePreferencesRequest,
  type UpdateProviderPreferenceRequest,
} from "@dougoos/shared";

const MAX_SSE_BUFFER_BYTES = 4 * 1_048_576;

export interface CoreConnection {
  readonly instanceId: string;
  readonly port: number;
  readonly token: string;
}

export type CoreFetch = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export class CoreClientError extends Error {
  readonly code: string;
  readonly response: RestErrorResponse | null;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: string,
    options: {
      readonly cause?: unknown;
      readonly message: string;
      readonly response?: RestErrorResponse;
      readonly retryable: boolean;
      readonly status: number;
    },
  ) {
    super(options.message, { cause: options.cause });
    this.name = "CoreClientError";
    this.code = code;
    this.response = options.response ?? null;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

function assertConnection(connection: CoreConnection): void {
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65_535) {
    throw new TypeError("Core connection port is invalid");
  }
  if (
    !/^[A-Za-z0-9_-]{43}$/u.test(connection.token) ||
    new TextEncoder().encode(connection.token).byteLength !== 43
  ) {
    throw new TypeError("Core connection token is invalid");
  }
  if (connection.instanceId.length < 1 || connection.instanceId.length > 256) {
    throw new TypeError("Core connection instanceId is invalid");
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new CoreClientError("CORE_PROTOCOL_ERROR", {
      cause: error,
      message: "Core returned an invalid JSON response",
      retryable: true,
      status: response.status,
    });
  }
}

async function responseError(response: Response): Promise<CoreClientError> {
  const value = await parseJson(response);
  const parsed = RestErrorResponseSchema.safeParse(value);
  if (!parsed.success) {
    return new CoreClientError("CORE_PROTOCOL_ERROR", {
      message: "Core returned an invalid structured error",
      retryable: true,
      status: response.status,
    });
  }
  return new CoreClientError(parsed.data.code, {
    message: parsed.data.message,
    response: parsed.data,
    retryable: parsed.data.retryable,
    status: response.status,
  });
}

function jsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  };
}

function requestSignal(signal: AbortSignal | undefined): Pick<RequestInit, "signal"> | object {
  return signal === undefined ? {} : { signal };
}

export class CoreApiClient {
  readonly instanceId: string;
  readonly #baseUrl: string;
  readonly #fetch: CoreFetch;
  readonly #token: string;

  constructor(
    connection: CoreConnection,
    fetchImplementation: CoreFetch = globalThis.fetch.bind(globalThis),
  ) {
    assertConnection(connection);
    this.instanceId = connection.instanceId;
    this.#baseUrl = `http://127.0.0.1:${connection.port}`;
    this.#fetch = fetchImplementation;
    this.#token = connection.token;
  }

  async #request<T>(path: string, schema: RuntimeSchema<T>, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#token}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) throw await responseError(response);
    const value = await parseJson(response);
    try {
      return schema.parse(value);
    } catch (error) {
      throw new CoreClientError("CORE_PROTOCOL_ERROR", {
        cause: error,
        message: "Core response failed runtime validation",
        retryable: true,
        status: response.status,
      });
    }
  }

  cancelTurn(turnId: string, signal?: AbortSignal): Promise<CancelTurnResponse> {
    return this.#request(
      `/api/turns/${encodeURIComponent(turnId)}/cancel`,
      CancelTurnResponseSchema,
      {
        ...jsonBody({}),
        method: "POST",
        ...requestSignal(signal),
      },
    );
  }

  createSession(
    request: CreateSessionRequest,
    signal?: AbortSignal,
  ): Promise<CreateSessionResponse> {
    return this.#request("/api/sessions", CreateSessionResponseSchema, {
      ...jsonBody(request),
      method: "POST",
      ...requestSignal(signal),
    });
  }

  createTurn(
    sessionId: string,
    request: CreateTurnRequest,
    signal?: AbortSignal,
  ): Promise<CreateTurnResponse> {
    return this.#request(
      `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      CreateTurnResponseSchema,
      {
        ...jsonBody(request),
        method: "POST",
        ...requestSignal(signal),
      },
    );
  }

  getGlobalSnapshot(
    includeSessionIds: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<GlobalSnapshot> {
    const query = new URLSearchParams();
    for (const sessionId of includeSessionIds) query.append("includeSessionId", sessionId);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.#request(`/api/snapshot${suffix}`, GlobalSnapshotSchema, requestSignal(signal));
  }

  getReady(signal?: AbortSignal): Promise<HealthReadyResponse> {
    return this.#request("/api/health/ready", HealthReadyResponseSchema, requestSignal(signal));
  }

  getPreferences(signal?: AbortSignal): Promise<PreferencesResponse> {
    return this.#request("/api/preferences", PreferencesResponseSchema, requestSignal(signal));
  }

  getSession(sessionId: string, signal?: AbortSignal): Promise<SessionSnapshot> {
    return this.#request(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      SessionSnapshotSchema,
      requestSignal(signal),
    );
  }

  listProviders(signal?: AbortSignal): Promise<ListProvidersResponse> {
    return this.#request("/api/providers", ListProvidersResponseSchema, requestSignal(signal));
  }

  listProviderPreferences(signal?: AbortSignal): Promise<ListProviderPreferencesResponse> {
    return this.#request(
      "/api/provider-preferences",
      ListProviderPreferencesResponseSchema,
      requestSignal(signal),
    );
  }

  listAgentCliInstallations(signal?: AbortSignal): Promise<ListAgentCliInstallationsResponse> {
    return this.#request(
      "/api/clis",
      ListAgentCliInstallationsResponseSchema,
      requestSignal(signal),
    );
  }

  refreshAgentCliInstallations(signal?: AbortSignal): Promise<ListAgentCliInstallationsResponse> {
    return this.#request("/api/clis/refresh", ListAgentCliInstallationsResponseSchema, {
      method: "POST",
      ...requestSignal(signal),
    });
  }

  updatePreferences(
    request: UpdatePreferencesRequest,
    signal?: AbortSignal,
  ): Promise<PreferencesResponse> {
    return this.#request("/api/preferences", PreferencesResponseSchema, {
      ...jsonBody(request),
      method: "POST",
      ...requestSignal(signal),
    });
  }

  updateProviderPreference(
    providerId: string,
    request: UpdateProviderPreferenceRequest,
    signal?: AbortSignal,
  ): Promise<ProviderPreferenceResponse> {
    return this.#request(
      `/api/provider-preferences/${encodeURIComponent(providerId)}`,
      ProviderPreferenceResponseSchema,
      {
        ...jsonBody(request),
        method: "PUT",
        ...requestSignal(signal),
      },
    );
  }

  doctor(providerId: string, signal?: AbortSignal): Promise<ProviderDoctorResponse> {
    return this.#request(
      `/api/providers/${encodeURIComponent(providerId)}/doctor`,
      ProviderDoctorResponseSchema,
      { method: "POST", ...requestSignal(signal) },
    );
  }

  resolveApproval(
    turnId: string,
    requestId: string,
    optionId: string,
    signal?: AbortSignal,
  ): Promise<ResolveApprovalResponse> {
    return this.#request(
      `/api/turns/${encodeURIComponent(turnId)}/approvals/${encodeURIComponent(requestId)}`,
      ResolveApprovalResponseSchema,
      {
        ...jsonBody({ optionId }),
        method: "POST",
        ...requestSignal(signal),
      },
    );
  }

  async *events(
    afterSeq: number,
    signal?: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<AgentEventEnvelope> {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new TypeError("afterSeq must be a nonnegative safe integer");
    }
    const response = await this.#fetch(`${this.#baseUrl}/api/events?afterSeq=${afterSeq}`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${this.#token}`,
      },
      ...requestSignal(signal),
    });
    if (!response.ok) throw await responseError(response);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new CoreClientError("CORE_PROTOCOL_ERROR", {
        message: "Core returned a non-SSE event stream",
        retryable: true,
        status: response.status,
      });
    }
    if (response.body === null) {
      throw new CoreClientError("CORE_PROTOCOL_ERROR", {
        message: "Core event stream has no body",
        retryable: true,
        status: response.status,
      });
    }
    onOpen?.();
    yield* parseEventStream(response.body, signal);
  }
}

async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AgentEventEnvelope> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      if (new TextEncoder().encode(buffer).byteLength > MAX_SSE_BUFFER_BYTES) {
        throw new CoreClientError("CORE_PROTOCOL_ERROR", {
          message: "Core event stream frame exceeded its safety limit",
          retryable: true,
          status: 200,
        });
      }
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed !== null) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseFrame(frame: string): AgentEventEnvelope | null {
  const lines = frame.split("\n");
  const data: string[] = [];
  let id: string | null = null;
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(data.join("\n")) as unknown;
  } catch (error) {
    throw new CoreClientError("CORE_PROTOCOL_ERROR", {
      cause: error,
      message: "Core sent invalid SSE JSON",
      retryable: true,
      status: 200,
    });
  }
  let envelope: AgentEventEnvelope;
  try {
    envelope = AgentEventEnvelopeSchema.parse(value);
  } catch (error) {
    throw new CoreClientError("CORE_PROTOCOL_ERROR", {
      cause: error,
      message: "Core sent an invalid event envelope",
      retryable: true,
      status: 200,
    });
  }
  if (id !== String(envelope.seq)) {
    throw new CoreClientError("CORE_PROTOCOL_ERROR", {
      message: "Core SSE id does not match envelope seq",
      retryable: true,
      status: 200,
    });
  }
  return envelope;
}
