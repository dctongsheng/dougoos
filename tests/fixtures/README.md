# Test fixtures

The desktop test fixture exposes `test-fake` only when
`DOUGOOS_TEST_FAKE_PROVIDER=1`. It never probes, authenticates, or represents a real
Agent Provider.

Prompt controls:

- `[fake:approval]` streams all seven message kinds and waits for `allow-once` or
  `reject`.
- `[fake:cancel]` stays active until the cancel endpoint is called.
- `[fake:crash]` emits an interrupted Turn followed by a safe process-crash error.
- `[fake:delayed]` uses longer deterministic delays for shutdown tests.

Do not place credentials, real prompts, machine paths, or Provider diagnostic output
in fixtures.
