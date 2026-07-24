import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { openStorage } from "../../../packages/storage/src/index.js";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface RendererBridge {
  getCoreConnection(): Promise<{
    readonly instanceId: string;
    readonly port: number;
    readonly token: string;
  }>;
}

async function coreRequest(
  page: Page,
  path: string,
  options: { readonly body?: unknown; readonly method?: string } = {},
): Promise<ApiResponse> {
  return await page.evaluate(
    async ({ body, method, path }) => {
      const bridge = (globalThis as typeof globalThis & { dougoos?: RendererBridge }).dougoos;
      if (bridge === undefined) throw new Error("Desktop bridge is unavailable");
      const connection = await bridge.getCoreConnection();
      const response = await fetch(`http://127.0.0.1:${String(connection.port)}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Bearer ${connection.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method: method ?? "GET",
      });
      return { body: await response.json(), status: response.status };
    },
    { ...options, path },
  );
}

test("runs the scripted Fake Provider through Desktop, Journal, SSE, and Web", async () => {
  const root = join(import.meta.dirname, "../../..");
  const desktopPath = join(root, "apps/desktop");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-fake-e2e-"));
  const databasePath = join(temporaryDirectory, "fake.sqlite");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(temporaryDirectory, "user-data")}`, desktopPath],
    env: {
      ...process.env,
      DOUGOOS_DATABASE_PATH: databasePath,
      DOUGOOS_TEST_FAKE_PROVIDER: "1",
    },
  });

  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("AgentOS", { timeout: 30_000 });
    await expect(page.locator("[data-production-ready=true]")).toBeVisible();

    const providers = await coreRequest(page, "/api/providers");
    expect(providers).toMatchObject({
      body: { providers: [{ id: "test-fake", status: "available" }] },
      status: 200,
    });
    const clis = await coreRequest(page, "/api/clis");
    expect(clis).toMatchObject({
      body: {
        clis: [
          { command: "claude", integratedProviderId: "claude-code" },
          { command: "codex", integratedProviderId: "codex" },
        ],
      },
      status: 200,
    });
    await page.getByLabel("设置").click();
    await expect(page.getByRole("heading", { name: "本地 CLI 自动检测" })).toBeVisible();
    await expect(page.getByText("2 个已安装")).toBeVisible();
    await expect(page.getByText("/fixture/bin/claude")).toBeVisible();
    await page.getByRole("button", { name: "重新检测" }).click();
    await expect(page.getByRole("button", { name: "重新检测" })).toBeEnabled();

    await expect(page.getByText("Test Fake Provider", { exact: true }).first()).toBeVisible();
    await page.getByText("Test Fake Provider", { exact: true }).first().click();
    await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();

    const cwdInput = page.getByLabel("Agent 工作目录");
    await cwdInput.fill(temporaryDirectory);
    await page.getByRole("button", { name: "新建 Session" }).click();
    let sessionId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, "/api/snapshot");
        const sessions = (snapshot.body as { sessions: readonly { id: string }[] }).sessions;
        sessionId = sessions[0]?.id ?? "";
        return sessionId;
      })
      .not.toBe("");

    const composer = page.getByLabel("向 Test Fake Provider 派发任务");
    await composer.fill("[fake:approval] [fake:tool-overflow] render all messages");
    await page.getByRole("button", { name: "发送消息" }).click();

    for (const kind of ["user", "text", "note", "tool", "diff", "approval"]) {
      await expect(page.locator(`[data-message-type="${kind}"]`).first()).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(page.locator('[data-message-type="think"]')).toHaveCount(0);
    await expect(page.locator('[data-message-type="text"]').first()).toContainText(
      "Fake Agent streamed a response.",
    );
    await expect(page.locator('[data-message-type="approval"]').first()).toContainText(
      "Run fake command",
    );
    const toolMessage = page.locator('[data-message-type="tool"]').first();
    const toolSummary = toolMessage.locator("summary");
    const toolDetails = toolMessage.locator(".tool-message-details");
    const toolInput = toolMessage.locator('[data-tool-detail="input"]');
    const toolResult = toolMessage.locator('[data-tool-detail="result"]');
    await expect(toolMessage).not.toHaveAttribute("open", "");
    await expect(toolSummary).toContainText("PI_CODING_AGENT=true");
    await expect(toolDetails).toBeHidden();
    await expect(toolInput).toContainText("TOOL_INPUT_END");

    const allowOnce = page.getByRole("button", { name: "Allow once" });
    await allowOnce.click();
    await expect(page.locator('[data-message-type="approval"]').first()).toContainText("✓ 已批准");
    await expect(toolResult).toContainText("TOOL_RESULT_END");
    await expect(toolMessage).not.toHaveAttribute("open", "");
    await expect(toolDetails).toBeHidden();

    await toolSummary.click();
    await expect(toolMessage).toHaveAttribute("open", "");
    await expect(toolDetails).toBeVisible();
    await expect(toolInput).toBeVisible();
    await expect(toolResult).toBeVisible();
    const toolLayout = await toolMessage.evaluate((element) => {
      const details = element.querySelector(".tool-message-details");
      const input = element.querySelector('[data-tool-detail="input"]');
      const result = element.querySelector('[data-tool-detail="result"]');
      const messageList = element.closest(".message-list");
      if (
        !(details instanceof HTMLElement) ||
        !(input instanceof HTMLElement) ||
        !(result instanceof HTMLElement) ||
        !(messageList instanceof HTMLElement)
      ) {
        throw new Error("Tool message layout elements are unavailable");
      }
      const renderedLineCount = (target: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(target);
        return new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => Math.round(rect.top)),
        ).size;
      };
      const toolRect = element.getBoundingClientRect();
      const listRect = messageList.getBoundingClientRect();
      return {
        detailsClientWidth: details.clientWidth,
        detailsScrollWidth: details.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        inputClientWidth: input.clientWidth,
        inputLines: renderedLineCount(input),
        inputScrollWidth: input.scrollWidth,
        inputWhiteSpace: getComputedStyle(input).whiteSpace,
        listClientWidth: messageList.clientWidth,
        listScrollWidth: messageList.scrollWidth,
        resultClientWidth: result.clientWidth,
        resultLines: renderedLineCount(result),
        resultScrollWidth: result.scrollWidth,
        resultWhiteSpace: getComputedStyle(result).whiteSpace,
        toolWithinMessageList: toolRect.right <= listRect.right + 1,
      };
    });
    expect(toolLayout.inputWhiteSpace).toBe("pre-wrap");
    expect(toolLayout.resultWhiteSpace).toBe("pre-wrap");
    expect(toolLayout.inputLines).toBeGreaterThanOrEqual(3);
    expect(toolLayout.resultLines).toBeGreaterThanOrEqual(3);
    expect(toolLayout.inputScrollWidth).toBeLessThanOrEqual(toolLayout.inputClientWidth + 1);
    expect(toolLayout.resultScrollWidth).toBeLessThanOrEqual(toolLayout.resultClientWidth + 1);
    expect(toolLayout.detailsScrollWidth).toBeLessThanOrEqual(toolLayout.detailsClientWidth + 1);
    expect(toolLayout.listScrollWidth).toBeLessThanOrEqual(toolLayout.listClientWidth + 1);
    expect(toolLayout.documentScrollWidth).toBeLessThanOrEqual(toolLayout.documentClientWidth + 1);
    expect(toolLayout.toolWithinMessageList).toBe(true);
    await toolSummary.click();
    await expect(toolMessage).not.toHaveAttribute("open", "");
    await expect(toolDetails).toBeHidden();
    let approvedTurnId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
        const turns = (
          snapshot.body as {
            turns: readonly { id: string; status: string }[];
          }
        ).turns;
        approvedTurnId = turns[0]?.id ?? "";
        return turns.find((turn) => turn.id === approvedTurnId)?.status;
      })
      .toBe("completed");
    const duplicateDecision = await coreRequest(
      page,
      `/api/turns/${approvedTurnId}/approvals/approval-${approvedTurnId}`,
      { body: { optionId: "allow-once" }, method: "POST" },
    );
    expect(duplicateDecision).toMatchObject({
      body: { code: "APPROVAL_ALREADY_RESOLVED", retryable: false },
      status: 409,
    });

    const approvedSnapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
    expect(
      new Set(
        (
          approvedSnapshot.body as {
            messages: readonly { kind: string; turnId: string }[];
          }
        ).messages
          .filter((message) => message.turnId === approvedTurnId)
          .map((message) => message.kind),
      ),
    ).toEqual(new Set(["approval", "diff", "note", "text", "think", "tool", "user"]));

    await expect(composer).toBeEnabled();
    await composer.fill("[fake:approval] reject this command");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator('[data-message-type="approval"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.locator('[data-message-type="approval"]').last()).toContainText("✕ 已拒绝");
    let rejectedTurnId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
        const turns = (
          snapshot.body as {
            turns: readonly { id: string; status: string }[];
          }
        ).turns;
        rejectedTurnId = turns.find((turn) => turn.id !== approvedTurnId)?.id ?? "";
        return turns.find((turn) => turn.id === rejectedTurnId)?.status;
      })
      .toBe("completed");

    await expect(composer).toBeEnabled();
    await composer.fill("[fake:cancel] stay active");
    await page.getByRole("button", { name: "发送消息" }).click();
    let cancelledTurnId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
        const turns = (
          snapshot.body as {
            turns: readonly { id: string; status: string }[];
          }
        ).turns;
        cancelledTurnId =
          turns.find((turn) => turn.id !== approvedTurnId && turn.id !== rejectedTurnId)?.id ?? "";
        return turns.find((turn) => turn.id === cancelledTurnId)?.status;
      })
      .toBe("running");
    await page.getByRole("button", { name: "停止" }).click();
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
        return (
          snapshot.body as {
            turns: readonly { id: string; status: string }[];
          }
        ).turns.find((turn) => turn.id === cancelledTurnId)?.status;
      })
      .toBe("cancelled");

    const userMessageCount = await page.locator('[data-message-type="user"]').count();
    await page.reload();
    const persistedSessionRow = page.locator(`.agent-session-row[data-session-id="${sessionId}"]`);
    await expect(persistedSessionRow).toContainText(
      "[fake:approval] [fake:tool-overflow] render all messages",
    );
    await persistedSessionRow.click();
    await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();
    await expect(page.locator('[data-message-type="user"]')).toHaveCount(userMessageCount);
    await expect(page.locator("[data-runtime-state=turn-running]")).toHaveCount(0);

    await page.getByRole("button", { name: "新建 Session" }).click();
    let secondSessionId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, "/api/snapshot");
        const sessions = (snapshot.body as { sessions: readonly { id: string }[] }).sessions;
        secondSessionId = sessions.find((session) => session.id !== sessionId)?.id ?? "";
        return sessions.length;
      })
      .toBe(2);
    await expect(page.locator('[data-message-type="user"]')).toHaveCount(0);

    await page.getByRole("button", { name: "历史" }).click();
    await page.locator(".history-card").filter({ hasText: sessionId }).getByRole("button").click();
    await expect(page.locator('[data-message-type="user"]')).toHaveCount(userMessageCount);
    await page.getByRole("button", { name: "历史" }).click();
    await page
      .locator(".history-card")
      .filter({ hasText: secondSessionId })
      .getByRole("button")
      .click();
    await expect(page.locator('[data-message-type="user"]')).toHaveCount(0);

    const maintenance = openStorage(databasePath);
    const retention = maintenance.pruneJournal({
      maxAgeMs: 10 * 365 * 24 * 60 * 60 * 1_000,
      maxEvents: 1,
    });
    maintenance.close();
    expect(retention.minAvailableSeq).toBeGreaterThan(0);
    const replayGap = await coreRequest(page, "/api/events?afterSeq=0");
    expect(replayGap).toMatchObject({
      body: { code: "REPLAY_GAP", retryable: true },
      status: 409,
    });
  } finally {
    await application.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test("hands the Home project to Fake Agent once and renders Markdown without reasoning", async () => {
  const root = join(import.meta.dirname, "../../..");
  const desktopPath = join(root, "apps/desktop");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-home-markdown-e2e-"));
  const firstProject = await mkdtemp(join(temporaryDirectory, "project-a-"));
  const secondProject = await mkdtemp(join(temporaryDirectory, "project-b-"));
  const application = await electron.launch({
    args: [`--user-data-dir=${join(temporaryDirectory, "user-data")}`, desktopPath],
    env: {
      ...process.env,
      DOUGOOS_DATABASE_PATH: join(temporaryDirectory, "fake.sqlite"),
      DOUGOOS_TEST_FAKE_PROVIDER: "1",
    },
  });

  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("AgentOS", { timeout: 30_000 });
    await expect(page.locator("[data-production-ready=true]")).toBeVisible();

    for (const cwd of [firstProject, secondProject]) {
      await expect
        .poll(async () => {
          const response = await coreRequest(page, "/api/sessions", {
            body: { cwd, providerId: "test-fake" },
            method: "POST",
          });
          return response.status;
        })
        .toBe(201);
    }
    const initialSnapshot = await coreRequest(page, "/api/snapshot");
    const initialSessions = (
      initialSnapshot.body as {
        sessions: readonly { cwd: string; id: string }[];
      }
    ).sessions;
    expect(initialSessions).toHaveLength(2);

    await page.reload();
    await expect(page.locator("[data-production-ready=true]")).toBeVisible();
    await page.getByText("Test Fake Provider", { exact: true }).first().click();
    const cwdInput = page.getByLabel("Agent 工作目录");
    await expect(cwdInput).toHaveValue(/project-[ab]-/u);
    const currentProject = await cwdInput.inputValue();
    const homeProject = currentProject === firstProject ? secondProject : firstProject;

    await page
      .locator(".sidebar")
      .getByRole("button", { exact: true, name: "新建任务" })
      .first()
      .click();
    await page.locator(".picker-button").filter({ hasText: "Test Fake Provider" }).click();
    await page
      .locator(".agent-menu")
      .getByRole("menuitem")
      .filter({ hasText: "Test Fake Provider" })
      .click();
    await page.locator(".path-button").click();
    await page.locator(".path-menu").getByRole("menuitem").filter({ hasText: homeProject }).click();
    await page.getByLabel("任务内容").fill("[fake:markdown] 验证项目交接与 Markdown");
    await page.getByLabel("发送任务").click();

    await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();
    await expect(cwdInput).toHaveValue(homeProject);
    await expect(page.locator('[data-message-type="user"]').last()).toContainText(
      "[fake:markdown] 验证项目交接与 Markdown",
    );

    const answer = page.locator('[data-message-type="text"]').last();
    await expect(answer.getByRole("heading", { level: 3, name: "Markdown 回归" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(answer.locator("br")).toHaveCount(2);
    await expect(answer.locator("li")).toHaveText(["条目一", "条目二"]);
    await expect(answer.locator("strong")).toHaveText("粗体结论");
    await expect(answer).not.toContainText("###");
    await expect(answer).not.toContainText("**");
    await expect(answer).not.toContainText("PRIVATE_REASONING_SENTINEL");
    await expect(page.locator('[data-message-type="think"]')).toHaveCount(0);
    await expect(page.getByText("PRIVATE_REASONING_SENTINEL", { exact: false })).toBeHidden();
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, "/api/snapshot");
        return (snapshot.body as { sessions: readonly unknown[] }).sessions.length;
      })
      .toBe(3);

    const agentTree = page.locator('.agent-tree[data-agent-id="claude"]');
    const expandAgent = page.getByRole("button", { name: "展开 Test Fake Provider 会话" });
    if (await expandAgent.isVisible()) await expandAgent.click();
    const sessionRows = agentTree.locator(".agent-session-row");
    await expect(sessionRows).toHaveCount(3);
    const renderedSessionIds = await sessionRows.evaluateAll((rows) =>
      rows.map((row) => row.dataset.sessionId ?? ""),
    );
    expect(new Set(renderedSessionIds).size).toBe(3);
    expect(renderedSessionIds).toEqual(
      expect.arrayContaining(initialSessions.map((session) => session.id)),
    );

    const targetSession = initialSessions.find((session) => session.cwd !== homeProject);
    expect(targetSession).toBeDefined();
    await agentTree.locator(`[data-session-id="${targetSession?.id ?? ""}"]`).click();
    await expect(cwdInput).toHaveValue(targetSession?.cwd ?? "");
    await expect(page.getByText(targetSession?.id ?? "", { exact: false }).first()).toBeVisible();
  } finally {
    await application.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
