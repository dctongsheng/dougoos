import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";

import type { HttpBindings } from "@hono/node-server";
import {
  ApprovalRouteParamsSchema,
  CancelTurnRequestSchema,
  CancelTurnResponseSchema,
  CONTRACT_LIMITS,
  ConversationDirectorySchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  CreateTurnRequestSchema,
  CreateTurnResponseSchema,
  EventStreamQuerySchema,
  EventIdSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  ListAgentCliInstallationsResponseSchema,
  ListProviderPreferencesResponseSchema,
  ListProvidersResponseSchema,
  MessageIdSchema,
  ProviderDoctorResponseSchema,
  ProviderIdSchema,
  ProviderPreferenceResponseSchema,
  ProviderPreferenceRouteParamsSchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  PreferencesResponseSchema,
  SessionRouteParamsSchema,
  SessionIdSchema,
  SessionPermissionSnapshotSchema,
  SessionSchema,
  SnapshotQuerySchema,
  TurnIdSchema,
  TurnRouteParamsSchema,
  UpdateProviderPreferenceRequestSchema,
  UpdatePreferencesRequestSchema,
  isTerminalTurnStatus,
  parseEventStreamAfterSeq,
  type Provider,
  type ProviderPreference,
  type Session,
} from "@dougoos/shared";
import { isStorageError } from "@dougoos/storage";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { CoreError, apiError, mapCoreFailure, notFound, replayGap, sessionBusy } from "./errors.js";
import { CoreEventHub } from "./event-hub.js";
import { createCoreEventStreamResponse } from "./stream.js";
import type { CoreDependencies, CoreSecurityOptions } from "./types.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;
const CORS_METHODS = new Set(["GET", "POST", "PUT"]);
const CORS_REQUEST_HEADERS = new Set(["authorization", "content-type"]);

type CoreBindings = { Bindings: HttpBindings };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: JSON_HEADERS,
    status,
  });
}

function corsResponse(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function assertBearerToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token) || Buffer.from(token, "base64url").byteLength !== 32) {
    throw new TypeError("bearer token must be an unpadded 256-bit base64url value");
  }
}

function assertPort(port: number | undefined): void {
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new TypeError("bound port must be a valid TCP port");
  }
}

function parseHostPort(value: string): { readonly hostname: string; readonly port: number } | null {
  try {
    const url = new URL(`http://${value}`);
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    if (url.hostname !== "127.0.0.1" || url.port === "") return null;
    const port = Number(url.port);
    return Number.isInteger(port) && port >= 1 && port <= 65_535
      ? { hostname: url.hostname, port }
      : null;
  } catch {
    return null;
  }
}

function authorizationToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(value);
  return match?.[1] ?? null;
}

async function parseJson(c: Context<CoreBindings>, allowEmpty = false): Promise<unknown> {
  const contentLength = c.req.header("content-length");
  if (allowEmpty && contentLength === "0") return {};
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (allowEmpty && contentLength === undefined) {
    const text = await c.req.text();
    if (text.length === 0) return {};
    if (contentType !== "application/json") {
      throw new CoreError("INVALID_REQUEST", {
        details: { phase: "request" },
        httpStatus: 400,
        retryable: false,
      });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CoreError("INVALID_REQUEST", {
        details: { phase: "request" },
        httpStatus: 400,
        retryable: false,
      });
    }
  }
  if (contentType !== "application/json") {
    throw new CoreError("INVALID_REQUEST", {
      details: { phase: "request" },
      httpStatus: 400,
      retryable: false,
    });
  }
  try {
    return await c.req.json();
  } catch {
    throw new CoreError("INVALID_REQUEST", {
      details: { phase: "request" },
      httpStatus: 400,
      retryable: false,
    });
  }
}

function parseWith<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new CoreError("INVALID_REQUEST", {
      details: { phase: "request" },
      httpStatus: 400,
      retryable: false,
    });
  }
}

function invalidConversationDirectory(): CoreError {
  return new CoreError("INVALID_REQUEST", {
    details: { phase: "request" },
    httpStatus: 400,
    retryable: false,
  });
}

async function isExistingDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export function generateBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

export type CoreLifecycleState = "closed" | "failed" | "ready" | "starting";

export class CoreRuntime {
  readonly app: Hono<CoreBindings>;
  readonly events = new CoreEventHub();
  readonly instanceId: string;

  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #clock: () => string;
  readonly #defaultConversationDirectory: string;
  readonly #deps: CoreDependencies;
  readonly #eventIdFactory: () => string;
  readonly #messageIdFactory: () => string;
  readonly #sessionIdFactory: () => string;
  readonly #token: string;
  readonly #turnIdFactory: () => string;

  #boundPort: number | undefined;
  #closePromise: Promise<void> | null = null;
  #initializePromise: Promise<boolean> | null = null;
  #state: CoreLifecycleState = "starting";
  #unsubscribeRegistry: (() => void) | null = null;

  constructor(dependencies: CoreDependencies, security: CoreSecurityOptions) {
    assertBearerToken(security.bearerToken);
    assertPort(security.boundPort);
    if (dependencies.appVersion.length === 0 || dependencies.appVersion.length > 128) {
      throw new TypeError("appVersion must contain 1..128 characters");
    }
    const defaultConversationDirectory = ConversationDirectorySchema.safeParse(
      dependencies.defaultConversationDirectory,
    );
    if (!defaultConversationDirectory.success) {
      throw new TypeError("defaultConversationDirectory must be an absolute directory path");
    }
    this.#deps = dependencies;
    this.#clock = dependencies.clock ?? (() => new Date().toISOString());
    this.#defaultConversationDirectory = defaultConversationDirectory.data;
    this.#eventIdFactory = dependencies.eventIdFactory ?? randomUUID;
    this.#messageIdFactory = dependencies.messageIdFactory ?? randomUUID;
    this.#sessionIdFactory = dependencies.sessionIdFactory ?? randomUUID;
    this.#turnIdFactory = dependencies.turnIdFactory ?? randomUUID;
    this.#token = security.bearerToken;
    this.#boundPort = security.boundPort;
    this.instanceId = dependencies.instanceId ?? randomUUID();
    this.#allowedOrigins = new Set(["app://dougoos", ...(security.allowedOrigins ?? [])]);
    this.app = this.#buildApp();
  }

  get state(): CoreLifecycleState {
    return this.#state;
  }

  setBoundPort(port: number): void {
    assertPort(port);
    if (this.#boundPort !== undefined && this.#boundPort !== port) {
      throw new Error("Core bound port cannot change within one instance");
    }
    this.#boundPort = port;
  }

  initialize(): Promise<boolean> {
    if (this.#state === "ready") return Promise.resolve(true);
    if (this.#state === "closed") return Promise.resolve(false);
    if (this.#initializePromise !== null) return this.#initializePromise;
    this.#state = "starting";
    const attempt = (async () => {
      try {
        const recovered = this.#deps.storage.recoverInterruptedTurns(this.#now());
        this.events.publishAll(recovered);
        this.#unsubscribeRegistry ??= this.#deps.registry.onEvent((runtimeEvent) => {
          const persisted = this.#deps.storage.appendAndProject({
            eventId: this.#newEventId(),
            runtimeEvent,
          });
          this.events.publish(persisted.envelope);
        });
        await this.#deps.registry.initialize();
        if (this.#state === "closed") return false;
        this.#state = "ready";
        return true;
      } catch {
        if (this.#state !== "closed") this.#state = "failed";
        return false;
      }
    })();
    this.#initializePromise = attempt;
    void attempt.then(
      () => {
        if (this.#initializePromise === attempt) this.#initializePromise = null;
      },
      () => {
        if (this.#initializePromise === attempt) this.#initializePromise = null;
      },
    );
    return attempt;
  }

  async close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#state = "closed";
    this.#closePromise = (async () => {
      try {
        this.#unsubscribeRegistry?.();
        this.#unsubscribeRegistry = null;
        await this.#deps.registry.close?.();
      } finally {
        this.#deps.storage.close();
      }
    })();
    return this.#closePromise;
  }

  #now(): string {
    const value = this.#clock();
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()))
      throw new TypeError("clock returned an invalid timestamp");
    return parsed.toISOString();
  }

  #newEventId() {
    return EventIdSchema.parse(this.#eventIdFactory());
  }

  #newMessageId() {
    return MessageIdSchema.parse(this.#messageIdFactory());
  }

  #newSessionId() {
    return SessionIdSchema.parse(this.#sessionIdFactory());
  }

  #newTurnId() {
    return TurnIdSchema.parse(this.#turnIdFactory());
  }

  #businessReady(): void {
    if (this.#state !== "ready") {
      throw new CoreError("CORE_NOT_READY", {
        details: { phase: "initialize" },
        httpStatus: 503,
        retryable: true,
      });
    }
  }

  #preferences() {
    return PreferencesResponseSchema.parse({
      conversationDirectory:
        this.#deps.storage.getConversationDirectory() ?? this.#defaultConversationDirectory,
    });
  }

  async #providers(): Promise<readonly Provider[]> {
    return ListProvidersResponseSchema.parse({
      providers: await this.#deps.registry.listProviders(),
    }).providers;
  }

  async #providerPreferences(): Promise<readonly ProviderPreference[]> {
    const providers = await this.#providers();
    const storedByProviderId = new Map(
      this.#deps.storage
        .listProviderPreferences()
        .map((preference) => [preference.providerId, preference]),
    );
    return ListProviderPreferencesResponseSchema.parse({
      preferences: providers
        .map(
          (provider): ProviderPreference =>
            storedByProviderId.get(provider.id) ?? {
              permissionProfileId: provider.defaultPermissionProfileId,
              providerId: provider.id,
              visibleInSidebar: true,
            },
        )
        .sort((left, right) => left.providerId.localeCompare(right.providerId)),
    }).preferences;
  }

  #unsupportedPermissionProfile(providerId: string): CoreError {
    return new CoreError("PROVIDER_CAPABILITY_UNSUPPORTED", {
      details: {
        capability: "permission.profile",
        operation: "create_session",
        providerId,
      },
      httpStatus: 409,
      retryable: false,
    });
  }

  async #resolvePermissionProfile(
    providerId: string,
    requestedProfileId: string | undefined,
  ): Promise<{ readonly profileId: string; readonly provider: Provider }> {
    const provider = (await this.#providers()).find((candidate) => candidate.id === providerId);
    if (provider === undefined) {
      throw new CoreError("PROVIDER_UNAVAILABLE", {
        details: { operation: "create_session", providerId },
        httpStatus: 503,
        retryable: true,
      });
    }
    const stored = this.#deps.storage.getProviderPreference(providerId);
    const profileId =
      requestedProfileId ?? stored?.permissionProfileId ?? provider.defaultPermissionProfileId;
    if (!provider.permissionProfiles.some((profile) => profile.id === profileId)) {
      throw this.#unsupportedPermissionProfile(providerId);
    }
    return { profileId, provider };
  }

  async #prepareConversationDirectoryForSession(cwd: string): Promise<void> {
    const configured = this.#deps.storage.getConversationDirectory();
    const effective = configured ?? this.#defaultConversationDirectory;
    if (cwd !== effective) return;
    if (configured !== null) {
      if (!(await isExistingDirectory(configured))) throw invalidConversationDirectory();
      return;
    }
    try {
      await mkdir(this.#defaultConversationDirectory, { mode: 0o700, recursive: true });
      if (!(await isExistingDirectory(this.#defaultConversationDirectory))) {
        throw invalidConversationDirectory();
      }
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw invalidConversationDirectory();
    }
  }

  #buildApp(): Hono<CoreBindings> {
    const app = new Hono<CoreBindings>();

    app.use("/api/*", async (c, next) => {
      const parsedHost = parseHostPort(c.req.header("host") ?? "");
      const socketPort = c.env?.incoming?.socket.localPort;
      const expectedPort = this.#boundPort ?? socketPort;
      if (parsedHost === null || expectedPort === undefined || parsedHost.port !== expectedPort) {
        return jsonResponse(apiError("FORBIDDEN_HOST", false), 403);
      }

      const origin = c.req.header("origin");
      if (origin !== undefined && !this.#allowedOrigins.has(origin)) {
        return jsonResponse(apiError("FORBIDDEN_ORIGIN", false), 403);
      }

      if (c.req.method === "OPTIONS") {
        const requestedMethod = c.req.header("access-control-request-method")?.toUpperCase();
        const requestedHeaders = (c.req.header("access-control-request-headers") ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase())
          .filter((header) => header.length > 0);
        if (
          origin === undefined ||
          requestedMethod === undefined ||
          !CORS_METHODS.has(requestedMethod) ||
          requestedHeaders.some((header) => !CORS_REQUEST_HEADERS.has(header))
        ) {
          return jsonResponse(apiError("FORBIDDEN_ORIGIN", false), 403);
        }
        return corsResponse(
          new Response(null, {
            headers: {
              "access-control-allow-headers": "authorization, content-type",
              "access-control-allow-methods": "GET, POST, PUT",
              "access-control-max-age": "600",
            },
            status: 204,
          }),
          origin,
        );
      }

      const token = authorizationToken(c.req.header("authorization"));
      if (token === null || !secureEqual(token, this.#token)) {
        const response = jsonResponse(apiError("UNAUTHORIZED", false), 401);
        return origin === undefined ? response : corsResponse(response, origin);
      }
      await next();
      if (origin !== undefined) c.res = corsResponse(c.res, origin);
      return;
    });

    app.use(
      "/api/*",
      bodyLimit({
        maxSize: CONTRACT_LIMITS.requestBodyBytes,
        onError: () => jsonResponse(apiError("PAYLOAD_TOO_LARGE", false), 413),
      }),
    );

    app.get("/api/health/live", () =>
      jsonResponse(
        HealthLiveResponseSchema.parse({
          checkedAt: this.#now(),
          instanceId: this.instanceId,
          status: "live",
        }),
      ),
    );

    app.get("/api/health/ready", () => {
      const ready = this.#state === "ready";
      const payload = ready
        ? {
            checkedAt: this.#now(),
            instanceId: this.instanceId,
            status: "ready" as const,
          }
        : {
            checkedAt: this.#now(),
            code: "CORE_NOT_READY" as const,
            status: "not_ready" as const,
          };
      return jsonResponse(HealthReadyResponseSchema.parse(payload), ready ? 200 : 503);
    });

    app.use("/api/*", async (c, next) => {
      try {
        this.#businessReady();
        return next();
      } catch (error) {
        const failure = mapCoreFailure(error);
        return jsonResponse(failure.body, failure.status);
      }
    });

    app.get("/api/providers", async () => {
      const providers = await this.#providers();
      return jsonResponse(ListProvidersResponseSchema.parse({ providers }));
    });

    app.get("/api/provider-preferences", async () =>
      jsonResponse(
        ListProviderPreferencesResponseSchema.parse({
          preferences: await this.#providerPreferences(),
        }),
      ),
    );

    app.put("/api/provider-preferences/:providerId", async (c) => {
      const params = parseWith(ProviderPreferenceRouteParamsSchema, {
        providerId: c.req.param("providerId"),
      });
      const request = parseWith(UpdateProviderPreferenceRequestSchema, await parseJson(c));
      const provider = (await this.#providers()).find(
        (candidate) => candidate.id === params.providerId,
      );
      if (provider === undefined) {
        return jsonResponse(notFound("provider", params.providerId), 404);
      }
      if (
        !provider.permissionProfiles.some((profile) => profile.id === request.permissionProfileId)
      ) {
        throw this.#unsupportedPermissionProfile(provider.id);
      }
      const preference = this.#deps.storage.upsertProviderPreference({
        permissionProfileId: request.permissionProfileId,
        providerId: provider.id,
        visibleInSidebar: request.visibleInSidebar,
      });
      return jsonResponse(ProviderPreferenceResponseSchema.parse({ preference }));
    });

    app.get("/api/preferences", () => jsonResponse(this.#preferences()));

    app.post("/api/preferences", async (c) => {
      const request = parseWith(UpdatePreferencesRequestSchema, await parseJson(c));
      if (!(await isExistingDirectory(request.conversationDirectory))) {
        throw invalidConversationDirectory();
      }
      this.#deps.storage.setConversationDirectory(request.conversationDirectory);
      return jsonResponse(this.#preferences());
    });

    app.get("/api/clis", async () => {
      const result =
        (await this.#deps.registry.listAgentCliInstallations?.()) ??
        ({ checkedAt: this.#now(), clis: [] } as const);
      return jsonResponse(ListAgentCliInstallationsResponseSchema.parse(result));
    });

    app.post("/api/clis/refresh", async () => {
      const result =
        (await this.#deps.registry.listAgentCliInstallations?.({ force: true })) ??
        ({ checkedAt: this.#now(), clis: [] } as const);
      return jsonResponse(ListAgentCliInstallationsResponseSchema.parse(result));
    });

    app.post("/api/providers/:providerId/doctor", async (c) => {
      const providerId = parseWith(ProviderIdSchema, c.req.param("providerId"));
      const result = await this.#deps.registry.doctor(providerId);
      const provider = ListProvidersResponseSchema.parse({
        providers: await this.#deps.registry.listProviders(),
      }).providers.find((candidate) => candidate.id === providerId);
      if (provider === undefined) {
        throw new CoreError("PROVIDER_UNAVAILABLE", {
          details: { operation: "doctor", providerId },
          httpStatus: 503,
          retryable: true,
        });
      }
      this.#deps.storage.upsertProviderStatus(provider);
      return jsonResponse(ProviderDoctorResponseSchema.parse({ result }));
    });

    app.post("/api/sessions", async (c) => {
      const request = parseWith(CreateSessionRequestSchema, await parseJson(c));
      const permissionResolution = await this.#resolvePermissionProfile(
        request.providerId,
        request.permissionProfileId,
      );
      const sessionId = this.#newSessionId();
      let createdRegistrySession = false;
      try {
        await this.#prepareConversationDirectoryForSession(request.cwd);
        const runtime = await this.#deps.registry.createSession({
          cwd: request.cwd,
          permissionProfileId: permissionResolution.profileId,
          providerId: request.providerId,
          sessionId,
        });
        createdRegistrySession = true;
        const permission = SessionPermissionSnapshotSchema.parse(runtime.permission);
        const effectiveProfile = permissionResolution.provider.permissionProfiles.find(
          (profile) => profile.id === permission.effectiveProfileId,
        );
        if (
          permission.requestedProfileId !== permissionResolution.profileId ||
          effectiveProfile === undefined ||
          permission.mechanism !== effectiveProfile.mechanism ||
          permission.permissionEnforcement !== effectiveProfile.permissionEnforcement
        ) {
          throw this.#unsupportedPermissionProfile(request.providerId);
        }
        const now = this.#now();
        const session: Session = SessionSchema.parse({
          capabilities: runtime.capabilities,
          createdAt: now,
          cwd: request.cwd,
          id: sessionId,
          permission,
          providerId: request.providerId,
          providerSessionId: runtime.providerSessionId,
          source: "dougoos",
          state: "idle",
          title: runtime.title,
          updatedAt: now,
        });
        const persisted = this.#deps.storage.createInitializedSession({
          eventId: this.#newEventId(),
          session,
        });
        this.events.publish(persisted.envelope);
        return jsonResponse(CreateSessionResponseSchema.parse({ session }), 201);
      } catch (error) {
        if (createdRegistrySession) {
          try {
            await this.#deps.registry.closeSession?.(sessionId);
          } catch {
            // Keep the persistence error as the primary failure.
          }
        }
        throw error;
      }
    });

    app.get("/api/sessions/:sessionId", (c) => {
      const params = parseWith(SessionRouteParamsSchema, {
        sessionId: c.req.param("sessionId"),
      });
      try {
        return jsonResponse(this.#deps.storage.getSessionSnapshot(params.sessionId));
      } catch (error) {
        if (isStorageError(error) && error.code === "NOT_FOUND") {
          return jsonResponse(notFound("session", params.sessionId), 404);
        }
        throw error;
      }
    });

    app.get("/api/snapshot", (c) => {
      const query = parseWith(SnapshotQuerySchema, {
        includeSessionId: c.req.queries("includeSessionId") ?? [],
      });
      try {
        return jsonResponse(this.#deps.storage.getGlobalSnapshot(query.includeSessionId));
      } catch (error) {
        if (isStorageError(error) && error.code === "NOT_FOUND") {
          const missing = query.includeSessionId[0] ?? "unknown";
          return jsonResponse(notFound("session", missing), 404);
        }
        throw error;
      }
    });

    app.get("/api/events", (c) => {
      const sessionId = c.req.query("sessionId");
      const query = parseWith(EventStreamQuerySchema, {
        afterSeq: c.req.query("afterSeq"),
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      const afterSeq = parseEventStreamAfterSeq(query);
      try {
        return createCoreEventStreamResponse(this.#deps.storage, this.events, {
          afterSeq,
          ...(this.#deps.eventStreamHeartbeatMs === undefined
            ? {}
            : { heartbeatIntervalMs: this.#deps.eventStreamHeartbeatMs }),
          signal: c.req.raw.signal,
          ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
        });
      } catch (error) {
        if (isStorageError(error) && error.code === "REPLAY_GAP") {
          return jsonResponse(
            replayGap(
              Number(error.details?.latestSeq ?? 0),
              Number(error.details?.minAvailableSeq ?? 0),
            ),
            409,
          );
        }
        if (isStorageError(error) && error.code === "REPLAY_CURSOR_AHEAD") {
          return jsonResponse(
            apiError("INVALID_REQUEST", false, {
              field: "afterSeq",
              operation: "stream",
            }),
            400,
          );
        }
        throw error;
      }
    });

    app.post("/api/sessions/:sessionId/turns", async (c) => {
      const params = parseWith(SessionRouteParamsSchema, {
        sessionId: c.req.param("sessionId"),
      });
      const request = parseWith(CreateTurnRequestSchema, await parseJson(c));
      const turnId = this.#newTurnId();
      try {
        const result = this.#deps.storage.createTurn({
          occurredAt: this.#now(),
          queuedEventId: this.#newEventId(),
          request,
          sessionId: params.sessionId,
          turnId,
          userMessages: request.content.map(() => ({
            eventId: this.#newEventId(),
            messageId: this.#newMessageId(),
          })),
        });
        this.events.publishAll(result.envelopes);
        if (result.created) {
          this.#deps.registry.startTurn({
            request,
            sessionId: params.sessionId,
            turnId: result.turnId,
          });
        }
        return jsonResponse(CreateTurnResponseSchema.parse({ turnId: result.turnId }), 202);
      } catch (error) {
        if (isStorageError(error) && error.code === "NOT_FOUND") {
          return jsonResponse(notFound("session", params.sessionId), 404);
        }
        if (isStorageError(error) && error.code === "SESSION_BUSY") {
          const activeTurnId = String(error.details?.activeTurnId ?? "");
          return jsonResponse(sessionBusy(params.sessionId, activeTurnId), 409);
        }
        throw error;
      }
    });

    app.post("/api/turns/:turnId/cancel", async (c) => {
      const params = parseWith(TurnRouteParamsSchema, { turnId: c.req.param("turnId") });
      parseWith(CancelTurnRequestSchema, await parseJson(c, true));
      const turn = this.#deps.storage.getTurn(params.turnId);
      if (turn === null) return jsonResponse(notFound("turn", params.turnId), 404);
      if (turn.status === "cancelled" || turn.status === "cancelling") {
        return jsonResponse(
          CancelTurnResponseSchema.parse({
            accepted: true,
            status: turn.status,
            turnId: turn.id,
          }),
          202,
        );
      }
      if (isTerminalTurnStatus(turn.status)) {
        return jsonResponse(apiError("TURN_NOT_CANCELLABLE", false), 409);
      }
      const status = await this.#deps.registry.cancelTurn({
        sessionId: turn.sessionId,
        turnId: turn.id,
      });
      return jsonResponse(
        CancelTurnResponseSchema.parse({ accepted: true, status, turnId: turn.id }),
        202,
      );
    });

    app.post("/api/turns/:turnId/approvals/:requestId", async (c) => {
      const params = parseWith(ApprovalRouteParamsSchema, {
        requestId: c.req.param("requestId"),
        turnId: c.req.param("turnId"),
      });
      const request = parseWith(ResolveApprovalRequestSchema, await parseJson(c));
      const approval = this.#deps.storage.getApproval(params.turnId, params.requestId);
      if (approval === null) {
        return jsonResponse(notFound("approval", params.requestId), 404);
      }
      if (
        approval.status === "expired" ||
        Date.parse(this.#now()) > Date.parse(approval.expiresAt)
      ) {
        return jsonResponse(apiError("APPROVAL_EXPIRED", false), 409);
      }
      if (approval.status !== "pending") {
        return jsonResponse(apiError("APPROVAL_ALREADY_RESOLVED", false), 409);
      }
      if (!approval.options.some((option) => option.optionId === request.optionId)) {
        return jsonResponse(apiError("APPROVAL_OPTION_INVALID", false), 400);
      }
      await this.#deps.registry.resolveApproval({
        optionId: request.optionId,
        requestId: approval.requestId,
        sessionId: approval.sessionId,
        turnId: approval.turnId,
      });
      return jsonResponse(
        ResolveApprovalResponseSchema.parse({
          accepted: true,
          requestId: approval.requestId,
        }),
        202,
      );
    });

    app.notFound((c) =>
      jsonResponse(notFound("route", new URL(c.req.url).pathname.slice(0, 128) || "/"), 404),
    );
    app.onError((error, c) => {
      const failure = mapCoreFailure(error);
      const response = jsonResponse(failure.body, failure.status);
      const origin = c.req.header("origin");
      return origin !== undefined && this.#allowedOrigins.has(origin)
        ? corsResponse(response, origin)
        : response;
    });
    return app;
  }
}

export function createCoreRuntime(
  dependencies: CoreDependencies,
  security: CoreSecurityOptions,
): CoreRuntime {
  return new CoreRuntime(dependencies, security);
}
