import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { MemoryItemFixture } from "./feature-fixtures.js";
import { agentById } from "./fixtures.js";
import type { MemoryTab, SaasFixture } from "./types.js";

interface MemoryPageProps {
  readonly fixture: SaasFixture;
  readonly initialTab: MemoryTab;
}

export function MemoryPage({ fixture, initialTab }: MemoryPageProps) {
  const memoryFixture = fixture.features.memory;
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");

  useEffect(() => setTab(initialTab), [initialTab]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return memoryFixture.items.filter((memory) => {
      if (tab === "notes" && memory.kind !== "note") return false;
      if (tab === "omi" && memory.kind !== "omi") return false;
      return (
        normalized.length === 0 ||
        memory.title.toLowerCase().includes(normalized) ||
        memory.body?.toLowerCase().includes(normalized) === true ||
        memory.project.toLowerCase().includes(normalized)
      );
    });
  }, [memoryFixture.items, query, tab]);

  const openStar = (memory: MemoryItemFixture) => {
    setTab(memory.kind === "note" ? "notes" : "omi");
    setQuery(memory.title.slice(0, 12));
  };
  const memoryCount = memoryFixture.items.filter((memory) => memory.kind === "omi").length;
  const noteCount = memoryFixture.items.length - memoryCount;

  return (
    <main className="memory-page page-stack" data-screen-label="Memory">
      <header className="memory-toolbar">
        <input
          aria-label="搜索记忆与笔记"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索记忆与笔记…"
          type="text"
          value={query}
        />
        <span>
          {memoryCount} 记忆 · {noteCount} 笔记
        </span>
      </header>
      <nav className="tab-row" aria-label="Memory 视图">
        {memoryFixture.tabs.map(([id, label]) => (
          <button
            aria-current={tab === id ? "page" : undefined}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            <span>{label}</span>
            {id === "recent" ? <small>{filtered.length}</small> : null}
          </button>
        ))}
      </nav>

      {tab === "graph" ? (
        <section className="memory-galaxy">
          <header>
            <strong>✦ MEMORY GALAXY</strong>
            <span>
              <b>{filtered.length}</b> 颗星 ·{" "}
              {query.trim().length === 0 ? memoryFixture.links.length : 0} 条关联
            </span>
            <small>悬停查看 · 点击打开记忆 · 更亮 = 最近更新</small>
          </header>
          <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
            {(query.trim().length === 0 ? memoryFixture.links : []).map(([from, to]) => {
              const start = memoryFixture.items[from];
              const end = memoryFixture.items[to];
              if (start === undefined || end === undefined) return null;
              return (
                <line
                  key={`${String(from)}-${String(to)}`}
                  x1={start.x}
                  x2={end.x}
                  y1={start.y}
                  y2={end.y}
                />
              );
            })}
          </svg>
          {filtered.map((memory) => (
            <button
              aria-label={memory.title}
              className="memory-star"
              key={memory.id}
              onClick={() => openStar(memory)}
              style={
                {
                  "--star-glow": `${Math.round(6 + memory.score * 16)}px`,
                  "--star-glow-color":
                    memory.score > 0.65 ? "rgba(200,180,255,.95)" : "rgba(150,130,220,.55)",
                  left: `${memory.x}%`,
                  top: `${memory.y}%`,
                } as CSSProperties
              }
              title={`${memory.title} · ${memory.date}`}
              type="button"
            >
              <i
                style={{
                  height: `${Math.round(4 + memory.score * 7)}px`,
                  opacity: 0.4 + memory.score * 0.6,
                  width: `${Math.round(4 + memory.score * 7)}px`,
                }}
              />
              {memory.score >= 0.45 ? (
                <small>
                  {memory.score >= 0.75
                    ? `${memory.title.slice(0, 18)}${memory.title.length > 18 ? "…" : ""}`
                    : memory.date}
                </small>
              ) : null}
            </button>
          ))}
        </section>
      ) : filtered.length === 0 ? (
        <section className="memory-empty">
          {tab === "notes" ? "没有匹配的笔记" : "没有匹配的记忆"}
        </section>
      ) : tab === "notes" ? (
        <section className="memory-note-grid">
          {filtered.map((memory) => (
            <article className="panel memory-note-card" key={memory.id}>
              <strong>{memory.title}</strong>
              <p>{memory.body}</p>
              <footer>
                <span>⌂ {memory.project}</span>
                <i />
                <time>{memory.date}</time>
              </footer>
            </article>
          ))}
        </section>
      ) : (
        <section className="memory-list">
          {filtered.map((memory) => {
            const agent = agentById(fixture, memory.agent);
            return (
              <article className="panel memory-card" key={memory.id}>
                <span
                  className="memory-list-glyph"
                  style={
                    {
                      "--agent-tone": memory.kind === "note" ? "#b48cff" : agent.tone,
                    } as CSSProperties
                  }
                >
                  {memory.kind === "note" ? "✎" : agent.glyph}
                </span>
                <div>
                  <strong>
                    <span>{memory.title}</span>
                  </strong>
                  <small>
                    {agent.name} · {memory.kind === "note" ? "笔记" : "记忆"}
                  </small>
                </div>
                <code>⌂ {memory.project}</code>
                <time>{memory.date}</time>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
