import {
  useEffect,
  useReducer,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  landingAgents,
  landingFeatures,
  landingKpis,
  landingProductCards,
  landingRoutes,
  landingStats,
  memoryStars,
} from "./fixtures.js";
import { createLandingPresentationState, reduceLandingPresentation } from "./state.js";
import { LANDING_ACCENTS, type LandingDisplayOptions } from "./types.js";

interface LandingAppProps {
  readonly initialDisplay: LandingDisplayOptions;
}

type CustomProperties = CSSProperties & Readonly<Record<`--${string}`, string>>;

const EARLY_ACCESS_DOWNLOAD_URL =
  "https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg";

const blockDemoNavigation = (event: MouseEvent<HTMLElement>): void => {
  event.preventDefault();
};

const blockComposingSubmit = (event: KeyboardEvent<HTMLInputElement>): void => {
  if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
};

const ThemeLogo = ({ size = "large" }: { readonly size?: "large" | "small" }) => (
  <span className={`landing-logo landing-logo-${size}`} aria-hidden="true">
    ◈
  </span>
);

const ProductWindow = () => (
  <section className="product-window" aria-label="AgentOS 产品窗口演示">
    <div className="product-titlebar">
      <span className="traffic-light traffic-red" />
      <span className="traffic-light traffic-yellow" />
      <span className="traffic-light traffic-green" />
      <span className="product-window-title">AgentOS — workspace / local</span>
    </div>
    <div className="product-content">
      <aside className="product-sidebar">
        <div className="product-nav product-nav-active">
          <span>＋</span> 新建任务
        </div>
        <div className="product-nav">
          <span>▦</span> 总览
        </div>
        <div className="product-nav">
          <span>▤</span> 任务编排
          <span className="product-badge">3</span>
        </div>
        <div className="product-nav">
          <span>✦</span> Memory
        </div>
        <div className="product-sidebar-heading">AGENTS</div>
        {landingAgents.map((agent) => (
          <div className="product-agent" key={agent.name}>
            <span
              className="product-agent-glyph"
              style={
                {
                  "--agent-hue": agent.hue,
                } as CustomProperties
              }
            >
              {agent.glyph}
            </span>
            <span className="product-agent-name">{agent.name}</span>
            <span
              className="product-agent-dot"
              style={{ animation: agent.pulse, background: agent.dot }}
            />
          </div>
        ))}
      </aside>
      <div className="product-main">
        <div className="product-kpis">
          {landingKpis.map((kpi) => (
            <div className="product-kpi" key={kpi.label}>
              <div>{kpi.label}</div>
              <strong style={{ color: kpi.color }}>{kpi.value}</strong>
            </div>
          ))}
        </div>
        <div className="product-cards">
          {landingProductCards.map((card) => (
            <div className="product-card" key={card.name} style={{ borderColor: card.border }}>
              <div className="product-card-header">
                <span
                  className="product-card-glyph"
                  style={
                    {
                      "--agent-hue": card.hue,
                    } as CustomProperties
                  }
                >
                  {card.glyph}
                </span>
                <strong>{card.name}</strong>
                <span
                  className="product-card-status"
                  style={
                    {
                      "--status-color": card.statusColor,
                    } as CustomProperties
                  }
                >
                  {card.status}
                </span>
              </div>
              <div className="product-card-task">{card.task}</div>
              <div className="product-card-last">{card.last}</div>
            </div>
          ))}
        </div>
        <div className="product-composer">
          <span className="product-composer-mark">❯</span>
          <span className="product-composer-copy">描述任务,智能路由到最合适的 Agent…</span>
          <span className="product-composer-key">⌘ ↵</span>
        </div>
      </div>
    </div>
  </section>
);

const LoginOverlay = ({
  close,
  complete,
}: {
  readonly close: () => void;
  readonly complete: () => void;
}) => {
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = [...(dialog?.querySelectorAll<HTMLElement>("button, input") ?? [])].filter(
        (control) => !control.hasAttribute("disabled"),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (dialog === null || first === undefined || last === undefined) return;
      const activeElement = document.activeElement;
      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (activeElement === first || activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    complete();
  };

  return (
    <div className="login-overlay" onClick={close}>
      <form
        aria-labelledby="login-title"
        aria-modal="true"
        className="login-modal"
        method="dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="login-title-row">
          <ThemeLogo size="small" />
          <div className="login-title" id="login-title">
            登录 AgentOS
          </div>
          <span className="login-title-spacer" />
          <button aria-label="关闭登录" className="modal-close" onClick={close} type="button">
            ✕
          </button>
        </div>
        <div className="login-copy">
          登录后可跨设备同步已提炼的知识与配置——原始会话数据始终留在本机。
        </div>
        <input
          aria-label="邮箱"
          autoComplete="off"
          className="login-input"
          inputMode="email"
          name="demo-email"
          onKeyDown={blockComposingSubmit}
          placeholder="邮箱"
          type="email"
        />
        <input
          aria-label="密码"
          autoComplete="new-password"
          className="login-input"
          name="demo-password"
          onKeyDown={blockComposingSubmit}
          placeholder="密码"
          type="password"
        />
        <button className="login-submit" type="submit">
          登录
        </button>
        <div className="login-divider">
          <span />
          或
          <span />
        </div>
        <div className="login-providers">
          <button aria-label="GitHub" className="login-provider" onClick={complete} type="button">
            <span className="mono" />
            GitHub
          </button>
          <button aria-label="Google" className="login-provider" onClick={complete} type="button">
            <span className="mono">G</span>Google
          </button>
        </div>
        <div className="register-copy">
          还没有账号?
          <button className="register-demo" onClick={blockDemoNavigation} type="button">
            注册 dougoos.com
          </button>
        </div>
      </form>
    </div>
  );
};

export const LandingApp = ({ initialDisplay }: LandingAppProps) => {
  const [state, dispatch] = useReducer(
    reduceLandingPresentation,
    initialDisplay,
    createLandingPresentationState,
  );
  const loginButtonRef = useRef<HTMLButtonElement>(null);
  const previousLoginOpen = useRef(state.loginOpen);

  useEffect(() => {
    document.documentElement.style.colorScheme = state.theme;
    document.body.style.background = state.theme === "light" ? "#f4f7f4" : "#0a0d0c";
  }, [state.theme]);

  useEffect(() => {
    if (previousLoginOpen.current && !state.loginOpen && !state.loggedIn) {
      loginButtonRef.current?.focus();
    }
    previousLoginOpen.current = state.loginOpen;
  }, [state.loggedIn, state.loginOpen]);

  const rootStyle = {
    "--accent": LANDING_ACCENTS[state.accent],
  } as CustomProperties;

  return (
    <main
      className={`landing-root theme-${state.theme}`}
      data-accent={state.accent}
      data-production-ready="true"
      data-screen-label="落地页"
      data-theme={state.theme}
      style={rootStyle}
    >
      <div className="landing-grid" />
      <div className="landing-radial" />
      <div className="landing-container">
        <header className="landing-header">
          <ThemeLogo />
          <div className="landing-brand">AgentOS</div>
          <span className="header-spacer" />
          <nav aria-label="主导航" className="landing-nav">
            {["功能", "Agents", "Memory", "文档"].map((label) => (
              <button key={label} onClick={blockDemoNavigation} type="button">
                {label}
              </button>
            ))}
          </nav>
          <button
            aria-label="切换主题"
            className="theme-toggle"
            onClick={() => dispatch({ type: "toggle-theme" })}
            title="切换主题"
            type="button"
          >
            {state.theme === "light" ? "☾" : "☀"}
          </button>
          {state.loggedIn ? (
            <div className="user-pill" aria-label="演示用户 Ryo">
              <span>R</span>
              <strong>Ryo</strong>
            </div>
          ) : (
            <button
              className="header-login"
              onClick={() => dispatch({ type: "open-login" })}
              ref={loginButtonRef}
              type="button"
            >
              登录
            </button>
          )}
          <a className="header-download" href={EARLY_ACCESS_DOWNLOAD_URL}>
            免费下载
          </a>
        </header>

        <section className="hero">
          <div className="version-chip">
            <span />
            v0.2.0 · Early Access · macOS Apple Silicon
          </div>
          <h1>
            多个 Agent CLI
            <br />
            一个控制台
          </h1>
          <p>
            Codex、Claude Code、Grok、Cursor、Pi、Hermes
            的桌面统一入口。派发任务、审批变更、管理会话与记忆——不再切换六个终端窗口。
          </p>
          <div className="hero-actions">
            <a className="primary-action" href={EARLY_ACCESS_DOWNLOAD_URL}>
              下载桌面版
            </a>
            <button className="secondary-action" onClick={blockDemoNavigation} type="button">
              在线体验 →
            </button>
          </div>
          <div className="install-command">
            macOS Apple Silicon · Early Access · 未经 Apple 公证
          </div>
          <section
            aria-labelledby="early-access-install-title"
            className="early-access-install"
            id="download"
          >
            <h2 id="early-access-install-title">四步开始体验</h2>
            <ol>
              <li>下载并打开 DMG</li>
              <li>拖入 Applications</li>
              <li>首次尝试启动</li>
              <li>被拦截时在“隐私与安全性”选择“仍要打开”</li>
            </ol>
          </section>
        </section>

        <ProductWindow />

        <section className="agent-strip" aria-label="已接入的 Agent CLI">
          <div className="agent-chips">
            {landingAgents.map((agent) => (
              <div className="agent-chip" key={agent.name}>
                <span style={{ color: agent.hue }}>{agent.glyph}</span>
                <strong>{agent.name}</strong>
                <code>{agent.bin}</code>
              </div>
            ))}
          </div>
          <p>已接入的 Agent CLI——检测本机安装,一键接管</p>
        </section>

        <section aria-labelledby="features-title">
          <div className="section-heading">
            <div>FEATURES</div>
            <h2 id="features-title">一个入口,管住整条 Agent 流水线</h2>
          </div>
          <div className="feature-grid">
            {landingFeatures.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-glyph">{feature.glyph}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="two-column routing-section" aria-labelledby="routing-title">
          <div>
            <div className="eyebrow">SMART ROUTING</div>
            <h3 id="routing-title">描述任务,系统选人</h3>
            <p>
              按任务类型、Agent 负载与历史成功率自动路由:重构给 Claude Code,脚本给 Codex,压测给
              Grok。也可以手动指定,或同题多发做结果对比。
            </p>
          </div>
          <div className="route-card">
            {landingRoutes.map((route) => (
              <div className="route-row" key={route.task}>
                <span className="route-task">{route.task}</span>
                <span className="route-arrow">→</span>
                <span className="route-agent" style={{ color: route.hue }}>
                  <span>{route.glyph}</span>
                  {route.agent}
                </span>
                <span className="route-confidence">{route.confidence}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="two-column memory-section" aria-labelledby="memory-title">
          <div className="memory-galaxy">
            {memoryStars.map((star, index) => (
              <span
                className="memory-star"
                key={`${star.x}-${star.y}-${index.toString()}`}
                style={{
                  boxShadow: `0 0 ${star.glow.toString()}px rgba(180,140,255,.8)`,
                  height: star.size,
                  left: `${star.x.toString()}%`,
                  opacity: star.opacity,
                  top: `${star.y.toString()}%`,
                  width: star.size,
                }}
              />
            ))}
            <span className="memory-label memory-label-rate">rate-limiter 决策</span>
            <span className="memory-label memory-label-schema">schema 迁移经验</span>
          </div>
          <div>
            <div className="memory-eyebrow">MEMORY</div>
            <h3 id="memory-title">Agent 学到的,不再丢</h3>
            <p>
              每次会话的决策、教训与技巧沉淀为记忆图谱,可检索、可做笔记,并能合成规则写回各 CLI 的
              CLAUDE.md / .cursorrules——知识在 Agent 之间流动。
            </p>
          </div>
        </section>

        <section className="stats" aria-label="AgentOS 数据">
          {landingStats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </section>

        <section className="final-cta">
          <h2>把所有终端窗口,收进一个 OS</h2>
          <p>免费、开源、本地优先。你的会话数据永远不离开你的机器。</p>
          <div>
            <a className="primary-action final-primary" href={EARLY_ACCESS_DOWNLOAD_URL}>
              下载 DougoOS
            </a>
            <button
              className="secondary-action final-secondary"
              onClick={blockDemoNavigation}
              type="button"
            >
              GitHub ↗
            </button>
          </div>
        </section>

        <footer className="landing-footer">
          <span className="footer-logo">◈</span> AgentOS ·
          <button className="footer-domain" onClick={blockDemoNavigation} type="button">
            dougoos.com
          </button>
          <span className="footer-spacer" />
          <button onClick={blockDemoNavigation} type="button">
            文档
          </button>
          <button onClick={blockDemoNavigation} type="button">
            更新日志
          </button>
          <span>许可证 MIT</span>
        </footer>
      </div>

      {state.loginOpen ? (
        <LoginOverlay
          close={() => dispatch({ type: "close-login" })}
          complete={() => dispatch({ type: "complete-demo-login" })}
        />
      ) : null}
    </main>
  );
};
