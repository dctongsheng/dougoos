import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

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

async function coreRequest(page: Page, path: string): Promise<ApiResponse> {
  return await page.evaluate(async (requestPath) => {
    const bridge = (globalThis as typeof globalThis & { dougoos?: RendererBridge }).dougoos;
    if (bridge === undefined) throw new Error("Desktop bridge is unavailable");
    const connection = await bridge.getCoreConnection();
    const response = await fetch(`http://127.0.0.1:${String(connection.port)}${requestPath}`, {
      headers: { authorization: `Bearer ${connection.token}` },
    });
    return { body: await response.json(), status: response.status };
  }, path);
}

test("runs a real Provider through the visible Desktop UI and restores the conversation", async ({
  browserName,
}, testInfo) => {
  test.skip(
    process.env.DOUGOOS_REAL_PROVIDER_E2E !== "1",
    "Set DOUGOOS_REAL_PROVIDER_E2E=1 to use local authenticated Provider state",
  );
  expect(browserName).toBe("chromium");
  test.setTimeout(180_000);

  const providerId = process.env.DOUGOOS_REAL_PROVIDER_ID ?? "codex";
  const root = join(import.meta.dirname, "../../..");
  const desktopPath = join(root, "apps/desktop");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-real-ui-e2e-"));
  const databasePath = join(temporaryDirectory, "real-provider.sqlite");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(temporaryDirectory, "user-data")}`, desktopPath],
    env: {
      ...process.env,
      DOUGOOS_DATABASE_PATH: databasePath,
    },
  });

  try {
    await writeFile(
      join(temporaryDirectory, "README.md"),
      "# DougoOS disposable real-provider UI fixture\n",
      "utf8",
    );
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("DougoOS", { timeout: 45_000 });

    const providersResponse = await coreRequest(page, "/api/providers");
    expect(providersResponse.status).toBe(200);
    const providers = (
      providersResponse.body as {
        providers: readonly {
          capabilities: {
            permissionEnforcement: string;
            protocolVersion: string;
            turn: { cancel: boolean };
          } | null;
          displayName: string;
          id: string;
          status: string;
          version?: string;
        }[];
      }
    ).providers;
    const provider = providers.find((candidate) => candidate.id === providerId);
    expect(provider, `Provider ${providerId} is not registered`).toBeDefined();
    expect(provider?.status, `Provider ${providerId} is not available`).toBe("available");
    if (provider === undefined) return;

    await page.getByText(provider.displayName, { exact: true }).first().click();
    await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();
    await page.getByLabel("Agent 工作目录").fill(temporaryDirectory);
    await page.getByRole("button", { name: "新建 Session" }).click();

    let sessionId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, "/api/snapshot");
        const sessions = (
          snapshot.body as {
            sessions: readonly { id: string; providerId: string }[];
          }
        ).sessions;
        sessionId = sessions.find((session) => session.providerId === providerId)?.id ?? "";
        return sessionId;
      })
      .not.toBe("");

    const composer = page.getByLabel(`向 ${provider.displayName} 派发任务`);
    await composer.fill("Reply with exactly DOUGOOS_REAL_UI_OK. Do not use tools or modify files.");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator('[data-message-type="text"]')).toContainText("DOUGOOS_REAL_UI_OK", {
      timeout: 120_000,
    });

    let firstTurnId = "";
    await expect
      .poll(async () => {
        const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
        const turns = (
          snapshot.body as {
            turns: readonly { id: string; status: string }[];
          }
        ).turns;
        firstTurnId = turns[0]?.id ?? "";
        return turns.find((turn) => turn.id === firstTurnId)?.status;
      })
      .toBe("completed");

    await page.reload();
    await page.getByText(provider.displayName, { exact: true }).first().click();
    await expect(page.locator('[data-message-type="text"]')).toContainText("DOUGOOS_REAL_UI_OK", {
      timeout: 30_000,
    });

    let approvalObserved = false;
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill(
      "Create approval-probe.txt in this workspace with the single line APPROVAL_PROBE. Do not change any other file.",
    );
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect
      .poll(
        async () => {
          const approval = page.locator('[data-message-type="approval"]').last();
          if (
            (await approval.count()) > 0 &&
            (await approval.getAttribute("data-approval-status")) === "pending"
          ) {
            approvalObserved = true;
            return "approval";
          }
          const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
          const turns = (
            snapshot.body as {
              turns: readonly { id: string; status: string }[];
            }
          ).turns;
          const latest = turns.find((turn) => turn.id !== firstTurnId);
          return latest?.status === "completed" || latest?.status === "failed"
            ? "terminal"
            : "waiting";
        },
        { timeout: 60_000 },
      )
      .not.toBe("waiting");
    if (approvalObserved) {
      await page
        .locator('[data-message-type="approval"][data-approval-status="pending"] .is-reject')
        .last()
        .click();
      await expect(
        page.locator('[data-message-type="approval"][data-approval-status="rejected"]').last(),
      ).toBeVisible();
    }

    let cancelObserved = false;
    if (provider.capabilities?.turn.cancel === true) {
      await expect(composer).toBeEnabled({ timeout: 60_000 });
      const beforeCancel = await coreRequest(page, `/api/sessions/${sessionId}`);
      const priorTurnIds = new Set(
        (
          beforeCancel.body as {
            turns: readonly { id: string }[];
          }
        ).turns.map((turn) => turn.id),
      );
      await composer.fill(
        "Analyze every detail of this disposable workspace and provide a very long report. Do not modify files.",
      );
      await page.getByRole("button", { name: "发送消息" }).click();
      await page.getByRole("button", { name: "停止" }).click({ timeout: 30_000 });
      await expect
        .poll(async () => {
          const snapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
          const latest = (
            snapshot.body as {
              turns: readonly { id: string; status: string }[];
            }
          ).turns.find((turn) => !priorTurnIds.has(turn.id));
          cancelObserved = latest?.status === "cancelled";
          return latest?.status;
        })
        .toBe("cancelled");
    }

    const finalSnapshot = await coreRequest(page, `/api/sessions/${sessionId}`);
    const snapshotBody = finalSnapshot.body as {
      messages: readonly { kind: string }[];
      turns: readonly {
        error: { code: string } | null;
        status: string;
        stopReason: string | null;
      }[];
    };
    const evidence = {
      approvalObserved,
      cancelObserved,
      messageKinds: [...new Set(snapshotBody.messages.map((message) => message.kind))],
      protocolVersion: provider.capabilities?.protocolVersion ?? null,
      providerId,
      status: snapshotBody.turns[0]?.status ?? null,
      stopReason: snapshotBody.turns[0]?.stopReason ?? null,
      version: provider.version ?? null,
    };
    await mkdir(join(root, ".artifacts"), { recursive: true });
    const evidencePath = join(root, ".artifacts", "real-provider-ui-e2e.json");
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await testInfo.attach("real-provider-ui-evidence", {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await application.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
