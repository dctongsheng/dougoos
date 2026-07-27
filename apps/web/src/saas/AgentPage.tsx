import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

import type {
  AgentHistoryItem,
  AgentMessage,
  ProductionStateNoticeFixture,
} from "./feature-fixtures.js";
import { agentById } from "./fixtures.js";
import {
  hasValidPermissionProfile,
  isAbsoluteWorkspacePath,
  resolveInitialAgentCwd,
} from "./home-task.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import type {
  AgentId,
  AgentStatus,
  AgentTab,
  ChatViewSnapshot,
  DataMode,
  Route,
  RuntimePresentation,
  RuntimePresentationKind,
  SaasAction,
  SaasDataCommand,
  SaasFeatureState,
  SaasFixture,
} from "./types.js";

interface AgentPageProps {
  readonly agentId: AgentId;
  readonly chat: ChatViewSnapshot | null;
  readonly chooseDirectory: () => Promise<string | null>;
  readonly dataMode: DataMode;
  readonly dispatch: (action: SaasAction) => void;
  readonly execute: (command: SaasDataCommand) => Promise<void>;
  readonly featureState: SaasFeatureState;
  readonly fixture: SaasFixture;
  readonly initialCwd: string | undefined;
  readonly navigate: (route: Route) => void;
  readonly onApprovalDecision: (agentId: AgentId) => void;
  readonly onRuntimeAction: () => void;
  readonly onRuntimeChange: (
    agentId: AgentId,
    status: AgentStatus,
    task: string,
    last: string,
  ) => void;
  readonly runtimePresentation: RuntimePresentation;
  readonly tab: AgentTab;
}

const messageId = (): string => `local-${crypto.randomUUID()}`;
const ToolDisclosure = "details";

const agentRuntime: Readonly<Record<AgentId, string>> = {
  claude: "11m00s",
  codex: "23m00s",
  cursor: "17m00s",
  grok: "4m00s",
  hermes: "0m00s",
  openclaw: "0m00s",
  opencode: "0m00s",
  pi: "0m00s",
};

const agentProject = (cwd: string): string =>
  ({
    "~/dev/api-server": "api-server",
    "~/dev/ml-pipeline": "ml-pipeline",
    "~/dev/webapp": "webapp",
  })[cwd] ?? "其他";

const compactAgentTokens = (tokens: number): string =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(2)}M`
    : tokens >= 1_000
      ? `${Math.round(tokens / 1_000)}k`
      : String(tokens);

export function AgentPage({
  agentId,
  chat,
  chooseDirectory,
  dataMode,
  dispatch,
  execute,
  featureState,
  fixture,
  initialCwd,
  navigate,
  onApprovalDecision,
  onRuntimeAction,
  onRuntimeChange,
  runtimePresentation,
  tab,
}: AgentPageProps) {
  const agent = agentById(fixture, agentId);
  const agentFixtures = fixture.features.agent;
  const messagesByAgent = featureState.agentMessages;
  const draft = featureState.agentDrafts[agentId] ?? "";
  const composing = useRef(false);
  const timers = useRef<readonly number[]>([]);
  const timerGeneration = useRef(0);
  const messages = messagesByAgent[agentId] ?? [];
  const histories = agentFixtures.histories[agentId] ?? [];
  const displayedMessages: readonly AgentMessage[] =
    dataMode === "real" ? messages.filter((message) => message.type !== "think") : messages;
  const provider = chat?.providers.find((candidate) => candidate.agentId === agentId);
  const providerPreference = chat?.providerPreferences.find(
    (preference) => preference.providerId === provider?.id,
  );
  const permissionProfileIsValid =
    dataMode !== "real" ||
    hasValidPermissionProfile(provider, providerPreference?.permissionProfileId);
  const selectedSessionId = chat?.selectedSessionIds[agentId];
  const selectedSession = chat?.sessions.find((candidate) => candidate.id === selectedSessionId);
  const [cwd, setCwd] = useState(
    resolveInitialAgentCwd({
      agentCwd: agent.cwd,
      launchCwd: initialCwd,
      selectedSessionCwd: selectedSession?.cwd,
    }),
  );
  const [resolvingApprovals, setResolvingApprovals] = useState<ReadonlySet<string>>(new Set());
  const writesDisabled =
    runtimePresentation.kind === "provider-probing-unavailable" ||
    runtimePresentation.kind === "turn-running" ||
    runtimePresentation.kind === "core-restart" ||
    runtimePresentation.kind === "replay-gap" ||
    runtimePresentation.kind === "session-busy" ||
    runtimePresentation.kind === "sse-reconnecting" ||
    runtimePresentation.kind === "turn-cancelling";
  const transportWritesDisabled =
    runtimePresentation.kind === "core-restart" ||
    runtimePresentation.kind === "replay-gap" ||
    runtimePresentation.kind === "sse-reconnecting";
  const sessionBusy =
    selectedSession?.state === "starting" ||
    selectedSession?.state === "running" ||
    selectedSession?.state === "awaiting_approval" ||
    selectedSession?.state === "cancelling";
  const validCwd = isAbsoluteWorkspacePath(cwd);
  const canReuseSelectedSession =
    selectedSession !== undefined &&
    selectedSession.providerId === provider?.id &&
    selectedSession.cwd === cwd &&
    selectedSession.state !== "closed" &&
    selectedSession.state !== "crashed";
  const permissionBlocksNextSend = !permissionProfileIsValid && !canReuseSelectedSession;
  const composerDisabled =
    writesDisabled ||
    sessionBusy ||
    (dataMode === "real" &&
      (!provider?.installed ||
        provider.status !== "available" ||
        !validCwd ||
        permissionBlocksNextSend));

  useEffect(
    () => () => {
      timerGeneration.current += 1;
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    setCwd(
      resolveInitialAgentCwd({
        agentCwd: agent.cwd,
        launchCwd: initialCwd,
        selectedSessionCwd: selectedSession?.cwd,
      }),
    );
  }, [agent.cwd, agentId, initialCwd, selectedSession?.cwd, selectedSession?.id]);

  const activeCwd = cwd || agent.cwd;

  const setTab = (nextTab: AgentTab) => navigate({ agentId, kind: "agent", tab: nextTab });

  const append = (targetAgent: AgentId, message: AgentMessage) => {
    dispatch({ agentId: targetAgent, message, type: "agent.message" });
  };

  const send = () => {
    if (composerDisabled) return;
    const text = draft.trim();
    if (text.length === 0) return;
    if (dataMode === "real") {
      if (provider === undefined) return;
      dispatch({ agentId, draft: "", type: "agent.draft" });
      void execute({
        agentId,
        cwd,
        name: "chat.send",
        providerId: provider.id,
        requestId: crypto.randomUUID(),
        sessionMode: "reuse",
        text,
      });
      return;
    }
    append(agentId, { body: text, id: messageId(), type: "user" });
    dispatch({ agentId, draft: "", type: "agent.draft" });
    const generation = timerGeneration.current;
    const thinkingTimer = window.setTimeout(() => {
      if (generation !== timerGeneration.current) return;
      append(agentId, {
        body: "正在分析仓库上下文与依赖 …",
        id: messageId(),
        type: "think",
      });
    }, 450);
    timers.current = [...timers.current, thinkingTimer];
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !composing.current &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  };

  const decide = (
    message: Extract<AgentMessage, { type: "approval" }>,
    optionId: string,
    approved: boolean,
  ) => {
    if (transportWritesDisabled || resolvingApprovals.has(message.id)) return;
    onApprovalDecision(agentId);
    if (dataMode === "real") {
      if (message.requestId === undefined || message.turnId === undefined) return;
      setResolvingApprovals((current) => new Set([...current, message.id]));
      void execute({
        name: "approval.resolve",
        optionId,
        requestId: message.requestId,
        turnId: message.turnId,
      }).finally(() => {
        setResolvingApprovals((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        });
      });
      return;
    }
    dispatch({ agentId, approved, messageId: message.id, type: "agent.approval" });
    if (approved) {
      onRuntimeChange(agentId, "executing", agent.task, "▸ prisma migrate deploy");
      append(agentId, {
        arg: message.command,
        id: messageId(),
        result: "运行中…",
        tool: "Bash",
        type: "tool",
      });
    } else {
      onRuntimeChange(agentId, "idle", agent.task, "✕ 部署被拒绝");
      append(agentId, {
        body: "✕ 已拒绝执行,任务挂起等待新指示",
        id: messageId(),
        type: "note",
      });
    }
  };

  const resume = (history: AgentHistoryItem) => {
    if (writesDisabled) return;
    if (dataMode === "real") {
      void execute({
        agentId,
        name: "session.select",
        sessionId: history.sessionId,
      });
      setTab("session");
      return;
    }
    append(agentId, {
      body: `↺ 已恢复会话 ${history.sessionId} · ${history.summary} (${history.messageCount} 条消息)`,
      id: messageId(),
      type: "note",
    });
    setTab("session");
  };

  const runSkill = (name: string) => {
    if (writesDisabled) return;
    onRuntimeChange(agentId, "thinking", `运行技能: ${name}`, "刚刚");
    append(agentId, {
      body: `运行技能:${name}`,
      id: messageId(),
      type: "user",
    });
    setTab("session");
  };

  const createSession = () => {
    if (
      writesDisabled ||
      !provider?.installed ||
      provider.status !== "available" ||
      !validCwd ||
      !permissionProfileIsValid
    ) {
      return;
    }
    void execute({
      agentId,
      cwd,
      name: "session.create",
      providerId: provider.id,
    });
  };

  const chooseCwd = () => {
    if (writesDisabled) return;
    void chooseDirectory().then((selected) => {
      if (selected !== null) setCwd(selected);
    });
  };

  const noticeContent =
    runtimePresentation.kind === "provider-probing-unavailable" && provider !== undefined
      ? {
          action: "运行 doctor",
          body: [provider.reason, provider.remediation].filter(Boolean).join(" · "),
          title: `${provider.displayName} · ${provider.status}`,
          tone: "warning" as const,
        }
      : runtimePresentation.kind === "capability-warning" && provider !== undefined
        ? {
            body: `权限执行级别: ${provider.capabilities?.permissionEnforcement ?? "未知"}。客户端只展示真实协商能力,不会承诺无法强制的阻断。`,
            title: "权限能力有限",
            tone: "warning" as const,
          }
        : runtimePresentation.kind === "turn-failed"
          ? {
              body: `${runtimePresentation.code} · ${runtimePresentation.message}`,
              title: "Agent 未返回结果",
              tone: "error" as const,
            }
          : runtimePresentation.kind === "normal"
            ? undefined
            : agentFixtures.runtimeStates[runtimePresentation.kind];

  return (
    <main className="agent-page" data-screen-label="Agent 会话">
      <header className="agent-header">
        <span className="agent-glyph large" style={{ "--agent-tone": agent.tone } as CSSProperties}>
          {agent.glyph}
        </span>
        <div className="agent-identity">
          <div>
            <strong>{agent.name}</strong>
            <span className={`agent-status status-${agent.status}`}>
              <i />
              {agent.status === "waiting"
                ? "等待确认"
                : agent.status === "executing"
                  ? "执行中"
                  : agent.status === "thinking"
                    ? "思考中"
                    : "空闲"}
            </span>
          </div>
          <small>
            ⌂ {agentProject(activeCwd)} · {agent.model} · {activeCwd} · ⏱{" "}
            {agentRuntime[agent.id] ?? "0m00s"} · {compactAgentTokens(agent.tokenCount)} tok ·{" "}
            <span>${agent.cost.toFixed(2)}</span>
          </small>
        </div>
        {agentId === "hermes" ? null : (
          <nav className="agent-segmented-tabs" aria-label={`${agent.name} 模块`}>
            {(["session", "history"] as const).map((nextTab) => (
              <button
                aria-current={tab === nextTab ? "page" : undefined}
                key={nextTab}
                onClick={() => setTab(nextTab)}
                type="button"
              >
                {nextTab === "session" ? "会话" : "历史"}
              </button>
            ))}
          </nav>
        )}
        <button
          className="agent-config-button"
          onClick={() => navigate({ agentId, kind: "settings" })}
          type="button"
        >
          ⚙ 配置
        </button>
      </header>

      {dataMode === "real" ? (
        <section className="real-chat-controls" aria-label="真实 Agent 会话设置">
          <label>
            <span>Provider</span>
            <select
              aria-label="选择 Provider"
              onChange={(event) => {
                const next = chat?.providers.find(
                  (candidate) => candidate.id === event.currentTarget.value,
                );
                if (next !== undefined) {
                  navigate({ agentId: next.agentId, kind: "agent", tab: "session" });
                }
              }}
              value={provider?.id ?? ""}
            >
              {chat?.providers
                .filter((candidate) => candidate.installed)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName} · {candidate.status}
                  </option>
                ))}
            </select>
          </label>
          <label className="real-chat-cwd">
            <span>工作目录</span>
            <input
              aria-label="Agent 工作目录"
              onChange={(event) => setCwd(event.currentTarget.value)}
              placeholder="请选择绝对路径"
              value={cwd}
            />
          </label>
          <button disabled={writesDisabled} onClick={chooseCwd} type="button">
            选择目录
          </button>
          <button
            disabled={
              writesDisabled ||
              !provider?.installed ||
              provider.status !== "available" ||
              !validCwd ||
              !permissionProfileIsValid
            }
            onClick={createSession}
            type="button"
          >
            新建 Session
          </button>
          <small>
            {selectedSession === undefined
              ? "尚未选择 Session；首次发送会显式创建"
              : `${selectedSession.title} · ${selectedSession.state} · ${selectedSession.id}`}
          </small>
          {!permissionProfileIsValid ? (
            <small className="permission-profile-stale">
              权限档位已失效；
              {canReuseSelectedSession
                ? "当前 Session 可继续使用，新建前请到配置中重新选择。"
                : "新建 Session 已被阻止，请到配置中重新选择。"}
            </small>
          ) : null}
        </section>
      ) : null}

      {agentId === "hermes" ? (
        <nav className="agent-module-tabs" aria-label={`${agent.name} 模块`}>
          {agentFixtures.tabs.hermes.map(([nextTab, glyph, label]) => (
            <button
              aria-current={tab === nextTab ? "page" : undefined}
              key={nextTab}
              onClick={() => setTab(nextTab)}
              type="button"
            >
              <span aria-hidden="true">{glyph}</span> <span>{label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <ProductionStateNotice
        content={noticeContent}
        runtimeKind={runtimePresentation.kind}
        onAction={onRuntimeAction}
      />

      {tab === "session" ? (
        <section className="conversation">
          <div className="message-list" aria-live="polite">
            {displayedMessages.length === 0 ? (
              <div className="conversation-empty">
                会话为空
                <br />
                <span>输入任务并回车,派发给 {agent.name}</span>
              </div>
            ) : (
              displayedMessages.map((message) => (
                <MessageView
                  key={message.id}
                  message={message}
                  onDecision={(optionId, approved) => {
                    if (message.type === "approval") decide(message, optionId, approved);
                  }}
                  renderFixturePresentation={dataMode === "fixture"}
                  writesDisabled={transportWritesDisabled || resolvingApprovals.has(message.id)}
                />
              ))
            )}
          </div>
          <div className="agent-composer">
            <textarea
              aria-label={`向 ${agent.name} 派发任务`}
              disabled={composerDisabled}
              onChange={(event) =>
                dispatch({
                  agentId,
                  draft: event.currentTarget.value,
                  type: "agent.draft",
                })
              }
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onKeyDown={onComposerKeyDown}
              placeholder={`向 ${agent.name} 派发任务 · Enter 发送`}
              rows={1}
              value={draft}
            />
            <button aria-label="发送消息" disabled={composerDisabled} onClick={send} type="button">
              发送
            </button>
          </div>
        </section>
      ) : tab === "history" ? (
        <section className="agent-module page-stack-inner">
          {histories.length === 0 ? (
            <div className="module-empty">暂无历史会话</div>
          ) : (
            histories.map((history) => (
              <article className="panel history-card" key={history.sessionId}>
                <div>
                  <strong>{history.summary}</strong>
                  <small>
                    {history.sessionId} · ⌂ {history.project} · {history.date} ·{" "}
                    {history.messageCount} 条消息 · {history.tokens} tok
                  </small>
                </div>
                <button disabled={writesDisabled} onClick={() => resume(history)} type="button">
                  ↺ 恢复
                </button>
              </article>
            ))
          )}
        </section>
      ) : tab === "skills" ? (
        <section className="agent-module hermes-skill-grid">
          {agentFixtures.skills.map(([glyph, name, description, runs]) => (
            <article className="hermes-skill-card" key={name}>
              <header>
                <span style={{ color: agent.tone }}>{glyph}</span>
                <strong>{name}</strong>
                <small>{runs} 次</small>
              </header>
              <p>{description}</p>
              <button disabled={writesDisabled} onClick={() => runSkill(name)} type="button">
                ▸ 运行
              </button>
            </article>
          ))}
        </section>
      ) : tab === "kanban" ? (
        <section className="agent-module hermes-kanban-grid">
          {agentFixtures.kanban.map((column) => (
            <article className="hermes-kanban-column" key={column.name}>
              <header style={{ color: column.color }}>
                <strong>{column.name}</strong>
                <small>{column.cards.length}</small>
              </header>
              {column.cards.map((card) => (
                <div className="hermes-kanban-card" key={card.title}>
                  <strong>{card.title}</strong>
                  <footer>
                    <span>⌂ {card.project}</span>
                    <i />
                    <time>{card.when}</time>
                  </footer>
                </div>
              ))}
            </article>
          ))}
        </section>
      ) : (
        <section className="agent-module hermes-mcp-list">
          {agentFixtures.mcps.map(([name, description, tools, on]) => (
            <article className="hermes-mcp-row" key={name}>
              <i className={on ? "is-on" : undefined} />
              <div>
                <strong>{name}</strong>
                <small>{description}</small>
              </div>
              <code>{tools} tools</code>
              <span className={on ? "is-on" : undefined}>{on ? "已连接" : "未连接"}</span>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function ProductionStateNotice({
  content,
  onAction,
  runtimeKind,
}: {
  readonly content: ProductionStateNoticeFixture | undefined;
  readonly onAction: () => void;
  readonly runtimeKind: RuntimePresentationKind;
}) {
  if (content === undefined) return null;
  return (
    <aside
      aria-live="polite"
      className={`production-state-notice is-${content.tone}`}
      data-runtime-notice={runtimeKind}
    >
      <span aria-hidden="true">{content.tone === "error" ? "!" : "◉"}</span>
      <div>
        <strong>{content.title}</strong>
        <p>{content.body}</p>
      </div>
      {content.action === undefined ? null : (
        <button onClick={onAction} type="button">
          {content.action}
        </button>
      )}
    </aside>
  );
}

function MessageView({
  message,
  onDecision,
  renderFixturePresentation,
  writesDisabled,
}: {
  readonly message: AgentMessage;
  readonly onDecision: (optionId: string, approved: boolean) => void;
  readonly renderFixturePresentation: boolean;
  readonly writesDisabled: boolean;
}) {
  switch (message.type) {
    case "user":
      return (
        <div className="message user-message" data-message-type="user">
          <span>{message.body}</span>
        </div>
      );
    case "text":
      return (
        <div
          className="message text-message"
          data-message-state={message.state}
          data-message-type="text"
        >
          <MarkdownMessage>{message.body}</MarkdownMessage>
        </div>
      );
    case "note":
      return (
        <div className="message note-message" data-message-type="note">
          <span>{message.body}</span>
        </div>
      );
    case "think":
      return renderFixturePresentation ? (
        <div className="message think-message" data-message-type="think">
          ▚ {message.body}
        </div>
      ) : null;
    case "tool": {
      const firstInputLine =
        message.arg
          .split(/\r?\n/u)
          .find((line) => line.trim() !== "")
          ?.trim() ?? "查看详情";
      const inputPreview =
        firstInputLine.length > 160 ? `${firstInputLine.slice(0, 159)}…` : firstInputLine;
      if (renderFixturePresentation) {
        return (
          <div className="message tool-message fixture-tool-message" data-message-type="tool">
            <span aria-hidden="true" className="tool-message-chevron">
              ▸
            </span>
            <strong>{message.tool}</strong>
            <code className="tool-message-preview">{inputPreview}</code>
            <small>{message.result}</small>
          </div>
        );
      }
      return (
        <ToolDisclosure className="message tool-message" data-message-type="tool">
          <summary aria-label={`${message.tool} 工具详情`}>
            <span aria-hidden="true" className="tool-message-chevron">
              ▸
            </span>
            <strong>{message.tool}</strong>
            <code className="tool-message-preview">{inputPreview}</code>
            <small>详情</small>
          </summary>
          <div className="tool-message-details">
            <div className="tool-message-detail">
              <span>参数</span>
              <pre aria-label={`${message.tool} 工具参数`} data-tool-detail="input">
                {message.arg}
              </pre>
            </div>
            <div className="tool-message-detail">
              <span>结果</span>
              <pre aria-label={`${message.tool} 工具结果`} data-tool-detail="result">
                {message.result}
              </pre>
            </div>
          </div>
        </ToolDisclosure>
      );
    }
    case "diff":
      return (
        <div className="message diff-message" data-message-type="diff">
          <header>
            <code>{message.file}</code>
            <span>+{message.additions}</span>
            <span>−{message.deletions}</span>
          </header>
          {message.lines.map((line) => (
            <code
              className={line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-del" : ""}
              key={line}
            >
              {line}
            </code>
          ))}
        </div>
      );
    case "approval": {
      const status =
        message.status ??
        (message.approved === true
          ? "allowed"
          : message.approved === false
            ? "rejected"
            : "pending");
      const options =
        message.options ??
        ([
          { kind: "allow", label: "批准执行", optionId: "allow" },
          { kind: "reject", label: "拒绝", optionId: "reject" },
        ] as const);
      const resolvedLabel =
        message.status === undefined && message.approved === true
          ? "✓ 已批准,执行中"
          : {
              allowed: "✓ 已批准",
              cancelled: "— 请求已取消",
              expired: "⌛ 请求已过期",
              pending: "",
              rejected: "✕ 已拒绝",
            }[status];
      return (
        <div
          className="message approval-message"
          data-approval-status={status}
          data-message-type="approval"
        >
          <strong>{message.body}</strong>
          <code>$ {message.command}</code>
          <p>{message.note}</p>
          {status === "pending" ? (
            <div>
              {options.map((option) => (
                <button
                  className={option.kind === "allow" ? "is-allow" : "is-reject"}
                  disabled={writesDisabled}
                  key={option.optionId}
                  onClick={() => onDecision(option.optionId, option.kind === "allow")}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <span className={status === "allowed" ? "is-approved" : "is-denied"}>
              {resolvedLabel}
            </span>
          )}
        </div>
      );
    }
  }
}
