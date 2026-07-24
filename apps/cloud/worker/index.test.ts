import { describe, expect, it, vi } from "vitest";

import { handleRequest } from "./index.js";

const assets = {
  fetch: vi.fn(async () => new Response("landing", { status: 200 })),
};

describe("Cloud health-only Worker", () => {
  it("serves a no-store versioned health response without storage or identifiers", async () => {
    const response = await handleRequest(new Request("https://agent-os.example/v1/health"), assets);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      service: "dougoos-cloud",
      status: "ok",
      v: 1,
    });
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("supports HEAD, rejects other health methods, and exposes no ingest route", async () => {
    const head = await handleRequest(
      new Request("https://agent-os.example/v1/health", { method: "HEAD" }),
      assets,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const post = await handleRequest(
      new Request("https://agent-os.example/v1/health", { method: "POST" }),
      assets,
    );
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");

    const ingest = await handleRequest(
      new Request("https://agent-os.example/v1/ingest", {
        body: JSON.stringify({
          cwd: "/must/not/leave/device",
          prompt: "must not leave device",
          token: "must-not-leave-device",
        }),
        method: "POST",
      }),
      assets,
    );
    expect(ingest.status).toBe(404);
    expect(await ingest.json()).toEqual({ code: "NOT_FOUND", status: "error" });
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("delegates non-API requests to the immutable static-assets binding", async () => {
    assets.fetch.mockClear();
    const request = new Request("https://agent-os.example/features");
    const response = await handleRequest(request, assets);

    expect(await response.text()).toBe("landing");
    expect(assets.fetch).toHaveBeenCalledOnce();
    expect(assets.fetch).toHaveBeenCalledWith(request);
  });
});
