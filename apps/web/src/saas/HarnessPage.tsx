import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { HarnessSection, SaasAction, SaasFeatureState, SaasFixture } from "./types.js";

export function HarnessPage({
  dispatch,
  featureState,
  fixture,
  section,
  writesDisabled,
}: {
  readonly dispatch: (action: SaasAction) => void;
  readonly featureState: SaasFeatureState;
  readonly fixture: SaasFixture;
  readonly section: HarnessSection;
  readonly writesDisabled: boolean;
}) {
  const harness = fixture.features.harness;
  const agentsById = new Map(fixture.agents.map((agent) => [agent.id, agent]));
  const visiblePromptGenomes = harness.promptGenomes.flatMap((genome) => {
    const agent = agentsById.get(genome.agentId);
    return agent === undefined ? [] : [{ agent, genome }];
  });
  const visibleSubagents = harness.subagents.flatMap((subagent) => {
    const agent = agentsById.get(subagent.agentId);
    return agent === undefined ? [] : [{ agent, subagent }];
  });
  const [openSegments, setOpenSegments] = useState<Record<string, string | undefined>>({});
  const mcpOn = featureState.harnessMcpOn;
  const hookOn = featureState.harnessHookOn;
  const runningWorkflow = featureState.harnessRunningWorkflow;
  const timer = useRef<number | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
      if (timer.current !== null) window.clearTimeout(timer.current);
      dispatch({ id: null, type: "harness.workflow" });
    },
    [dispatch],
  );

  const categoryById = (id: string) => {
    const category = harness.promptCategories.find((candidate) => candidate.id === id);
    if (category === undefined) throw new Error(`Unknown prompt category: ${id}`);
    return category;
  };

  const runWorkflow = (id: string) => {
    if (writesDisabled || runningWorkflow !== null) return;
    generation.current += 1;
    const requestedGeneration = generation.current;
    dispatch({ id, type: "harness.workflow" });
    timer.current = window.setTimeout(() => {
      if (requestedGeneration !== generation.current) return;
      timer.current = null;
      dispatch({ id: null, type: "harness.workflow" });
    }, 2_200);
  };

  return (
    <main className="harness-page page-stack" data-screen-label="Harness">
      {section === "prompt" ? (
        <>
          <p className="hz-description">
            每个 Agent 的系统提示词按模块拆成色段 · 条带总长 = 字符数 · 点击色段读真实片段
          </p>
          <div className="hz-legend">
            {harness.promptCategories.map((category) => (
              <span key={category.id}>
                <i style={{ background: category.color }} />
                {category.name}
              </span>
            ))}
          </div>
          <section className="hz-genome-list">
            {visiblePromptGenomes.map(({ agent, genome }) => {
              const openId = openSegments[genome.agentId];
              const openSegment = genome.segments.find((segment) => segment.category === openId);
              const openCategory =
                openSegment === undefined ? undefined : categoryById(openSegment.category);
              return (
                <article className="hz-genome-card" key={genome.agentId}>
                  <header>
                    <span
                      className="hz-agent-glyph"
                      style={{ "--agent-tone": agent.tone } as CSSProperties}
                    >
                      {agent.glyph}
                    </span>
                    <strong>{agent.name}</strong>
                    <code>{genome.file}</code>
                    <i />
                    <small>{genome.characters.toLocaleString()} 字符</small>
                  </header>
                  <div
                    className="hz-genome-track"
                    style={{
                      width: `${Math.max(18, Math.round((genome.characters / 9800) * 100))}%`,
                    }}
                  >
                    {genome.segments.map((segment) => {
                      const category = categoryById(segment.category);
                      return (
                        <button
                          key={`${genome.agentId}-${segment.category}`}
                          onClick={() =>
                            setOpenSegments((current) => ({
                              ...current,
                              [genome.agentId]:
                                current[genome.agentId] === segment.category
                                  ? undefined
                                  : segment.category,
                            }))
                          }
                          style={{
                            background: category.color,
                            opacity:
                              openId !== undefined && openId !== segment.category ? 0.35 : 0.85,
                            width: `${Math.round((segment.mass / genome.characters) * 100)}%`,
                          }}
                          title={`${category.name} · ${segment.mass.toLocaleString()} 字符`}
                          type="button"
                        />
                      );
                    })}
                  </div>
                  {openSegment !== undefined && openCategory !== undefined ? (
                    <div className="hz-prompt-expanded">
                      <header>
                        <i style={{ background: openCategory.color }} />
                        <strong>{openCategory.name}</strong>
                        <small>
                          {openSegment.mass.toLocaleString()} 字符 ·{" "}
                          {Math.round((openSegment.mass / genome.characters) * 100)}%
                        </small>
                      </header>
                      <p>
                        <span>{openSegment.body}</span>
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {visiblePromptGenomes.length === 0 ? (
              <div className="module-empty">当前 Agent 没有可用的系统提示词数据</div>
            ) : null}
          </section>
        </>
      ) : section === "skills" ? (
        <>
          <p className="hz-description">挂载到各 Agent 的技能包 · 点击查看引用</p>
          <section className="hz-card-grid hz-skills-grid">
            {harness.skills.map((skill) => (
              <article className="hz-skill-card" key={skill.name}>
                <header>
                  <strong>{skill.name}</strong>
                  <i />
                  <small>v{skill.version}</small>
                </header>
                <p>{skill.description}</p>
                <footer>
                  {skill.users.flatMap((agentId) => {
                    const agent = agentsById.get(agentId);
                    return agent === undefined
                      ? []
                      : [
                          <span
                            className="hz-mini-agent"
                            key={agentId}
                            style={{ "--agent-tone": agent.tone } as CSSProperties}
                            title={agent.name}
                          >
                            {agent.glyph}
                          </span>,
                        ];
                  })}
                  <i />
                  <small>{skill.calls} 次调用</small>
                </footer>
              </article>
            ))}
          </section>
        </>
      ) : section === "mcp" ? (
        <>
          <p className="hz-description">MCP Server 注册表 · 一处配置,多 Agent 共享</p>
          <section className="hz-registry-list">
            {harness.mcps.map((mcp) => (
              <article className="hz-mcp-row" key={mcp.id}>
                <i className={mcpOn[mcp.id] === true ? "is-on" : ""} />
                <div>
                  <header>
                    <strong>{mcp.name}</strong>
                    <code>{mcp.transport}</code>
                  </header>
                  <small>{mcp.description}</small>
                </div>
                <div className="hz-agent-stack">
                  {mcp.users.flatMap((agentId) => {
                    const agent = agentsById.get(agentId);
                    return agent === undefined
                      ? []
                      : [
                          <span
                            className="hz-mini-agent"
                            key={agentId}
                            style={{ "--agent-tone": agent.tone } as CSSProperties}
                            title={agent.name}
                          >
                            {agent.glyph}
                          </span>,
                        ];
                  })}
                </div>
                <code className="hz-tool-count">{mcp.tools} tools</code>
                <button
                  aria-label={`${mcp.name} MCP`}
                  aria-pressed={mcpOn[mcp.id] === true}
                  className="switch"
                  disabled={writesDisabled}
                  onClick={() => {
                    if (!writesDisabled) dispatch({ id: mcp.id, type: "harness.mcp-toggle" });
                  }}
                  type="button"
                >
                  <span />
                </button>
              </article>
            ))}
          </section>
        </>
      ) : section === "hooks" ? (
        <>
          <p className="hz-description">生命周期钩子 · 在会话事件点注入自动化</p>
          <section className="hz-registry-list">
            {harness.hooks.map((hook) => (
              <article className="hz-hook-row" key={hook.id}>
                <code style={{ "--hook-tone": hook.tone } as CSSProperties}>{hook.event}</code>
                <div>
                  <strong>{hook.name}</strong>
                  <small>$ {hook.command}</small>
                </div>
                <small>{hook.runs} 次触发</small>
                <button
                  aria-label={hook.name}
                  aria-pressed={hookOn[hook.id] === true}
                  className="switch"
                  disabled={writesDisabled}
                  onClick={() => {
                    if (!writesDisabled) dispatch({ id: hook.id, type: "harness.hook-toggle" });
                  }}
                  type="button"
                >
                  <span />
                </button>
              </article>
            ))}
          </section>
        </>
      ) : section === "subagents" ? (
        <>
          <p className="hz-description">
            子代理编队 · 主 Agent 可派生的专职分身,各带独立提示词与工具白名单
          </p>
          <section className="hz-card-grid hz-subagent-grid">
            {visibleSubagents.map(({ agent, subagent }) => {
              return (
                <article className="hz-subagent-card" key={subagent.name}>
                  <header>
                    <span
                      className="hz-agent-glyph"
                      style={{ "--agent-tone": agent.tone } as CSSProperties}
                    >
                      {agent.glyph}
                    </span>
                    <div>
                      <strong>{subagent.name}</strong>
                      <small>
                        宿主 {subagent.host} · {subagent.model}
                      </small>
                    </div>
                    <small>{subagent.spawns} 次派生</small>
                  </header>
                  <p>{subagent.description}</p>
                  <footer>
                    {subagent.tools.map((tool) => (
                      <code key={tool}>{tool}</code>
                    ))}
                  </footer>
                </article>
              );
            })}
            {visibleSubagents.length === 0 ? (
              <div className="module-empty">当前 Agent 没有可用的子代理数据</div>
            ) : null}
          </section>
        </>
      ) : section === "goal" ? (
        <>
          <p className="hz-description">长期目标 · Agent 持续在后台推进,进度由完成的子任务累积</p>
          <section className="hz-goal-list">
            {harness.goals.map((goal) => (
              <article className="hz-goal-card" key={goal.name}>
                <header>
                  <strong>◎ {goal.name}</strong>
                  <i />
                  <code style={{ "--goal-tone": goal.statusTone } as CSSProperties}>
                    {goal.status}
                  </code>
                </header>
                <p>{goal.description}</p>
                <div className="hz-goal-progress">
                  <div>
                    <span style={{ width: `${goal.percent}%` }} />
                  </div>
                  <code>{goal.percent}%</code>
                </div>
                <footer>
                  {goal.owners.flatMap((agentId) => {
                    const agent = agentsById.get(agentId);
                    return agent === undefined
                      ? []
                      : [
                          <span
                            className="hz-mini-agent"
                            key={agentId}
                            style={{ "--agent-tone": agent.tone } as CSSProperties}
                            title={agent.name}
                          >
                            {agent.glyph}
                          </span>,
                        ];
                  })}
                  <span>
                    {goal.done}/{goal.total} 子任务
                  </span>
                  <i />
                  <span>下一步:{goal.next}</span>
                </footer>
              </article>
            ))}
          </section>
        </>
      ) : section === "workflows" ? (
        <>
          <p className="hz-description">
            多 Agent 工作流 · 节点串联成流水线,可手动触发或由事件驱动
          </p>
          <section className="hz-workflow-list">
            {harness.workflows.map((workflow) => {
              const running = runningWorkflow === workflow.id;
              const visibleSteps = workflow.steps.flatMap((step) => {
                const agent = agentsById.get(step.agentId);
                return agent === undefined ? [] : [{ agent, step }];
              });
              return (
                <article className="hz-workflow-card" key={workflow.id}>
                  <header>
                    <strong>⧉ {workflow.name}</strong>
                    <code>{workflow.trigger}</code>
                    <i />
                    <small>
                      {workflow.runs} 次运行 · 上次 {workflow.last}
                    </small>
                    <button
                      disabled={writesDisabled || runningWorkflow !== null}
                      onClick={() => runWorkflow(workflow.id)}
                      type="button"
                    >
                      {running ? "运行中…" : "▸ 运行"}
                    </button>
                  </header>
                  <div className="hz-workflow-steps">
                    {visibleSteps.map(({ agent, step }, index) => {
                      const status = running ? "▸ 运行中" : step.status;
                      return (
                        <div className="hz-workflow-node-wrap" key={`${workflow.id}-${step.name}`}>
                          <div
                            className={running ? "hz-workflow-node is-running" : "hz-workflow-node"}
                          >
                            <span
                              className="hz-mini-agent"
                              style={{ "--agent-tone": agent.tone } as CSSProperties}
                            >
                              {agent.glyph}
                            </span>
                            <div>
                              <strong>{step.name}</strong>
                              <small
                                className={
                                  running
                                    ? "is-running"
                                    : step.status.startsWith("✓")
                                      ? "is-success"
                                      : step.status.startsWith("⚠")
                                        ? "is-warning"
                                        : ""
                                }
                              >
                                {status}
                              </small>
                            </div>
                          </div>
                          {index < visibleSteps.length - 1 ? <i>→</i> : null}
                        </div>
                      );
                    })}
                    {visibleSteps.length === 0 ? (
                      <div className="module-empty">当前 Agent 无法运行此工作流</div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      ) : (
        <>
          <p className="hz-description">项目级规则文件 · 派发任务时自动注入对应 Agent 的上下文</p>
          <section className="hz-card-grid hz-rules-grid">
            {harness.rules.map((rule) => (
              <article className="hz-rule-card" key={`${rule.project}-${rule.file}`}>
                <header>
                  <span>§</span>
                  <strong>{rule.file}</strong>
                  <i />
                  <code>⌂ {rule.project}</code>
                </header>
                <p>{rule.description}</p>
                <small>
                  {rule.ruleCount} 条规则 · {rule.date} 更新 · 来源 {rule.source}
                </small>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
