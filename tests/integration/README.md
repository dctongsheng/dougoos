# Integration tests

Cross-package integration coverage currently lives beside the boundary it verifies:

- `packages/core/src/app.test.ts` verifies Registry events commit to Journal before
  live fan-out.
- `packages/core/src/server.test.ts` verifies an active SSE connection cannot block
  Core shutdown.
- `tests/e2e/desktop/fake-agent.spec.ts` runs the test-only Fake Provider through
  Electron, Core, SQLite Journal, fetch-SSE, the Web reducer, and rendered message
  components.

Run the full desktop path with `pnpm test:desktop`.
