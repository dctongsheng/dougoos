---
task: ui-regression-001
review: 01
base: 2852a91497192d6513856ad6a16e84d74fb0b968
candidate: 373a15a672af4e3cfc66b22b369275f9f5b82f8b
reviewed-at: 2026-07-24T21:48:24+08:00
result: pass
---

# ui-regression-001 Independent Review 01

## Conclusion

`pass`

The candidate restores the prototype fixture/real Provider boundary without changing the committed
reference inputs, prototype files, visual manifest, thresholds, or release safety boundary. All
task-required gates pass. No blocking finding was found.

## Scope

- Base: `2852a91497192d6513856ad6a16e84d74fb0b968`
- Candidate: `373a15a672af4e3cfc66b22b369275f9f5b82f8b`
- Reviewed diff: `2852a91..373a15a`
- Reviewer changed no implementation and did not change task status.

## Requirement Review

1. **Fixture remains six Agents — pass.**
   `agentFixtures` contains Codex, Claude Code, Grok, Cursor, Pi, and Hermes only.
   `PROTOTYPE_AGENT_IDS` and `fixtures.test.ts` lock that list.
2. **Real Provider discovery retains OpenClaw/OpenCode — pass.**
   `AGENT_IDS` still includes both IDs. `fixtureFromCoreState` appends non-prototype Providers from
   the real registry snapshot, and the unit test proves the resulting eight-Agent real snapshot.
3. **Safe fixture `think` remains visible — pass.**
   Fixture mode renders the canned `think` component; browser E2E observes the expected canned
   message after a fixture prompt.
4. **Real raw reasoning remains private — pass.**
   Core-to-UI mapping drops `LiveMessage.kind === "think"` before creating the returned UI snapshot.
   Real-mode rendering also filters `think` defensively. Unit coverage proves a sentinel is absent
   from the serialized UI snapshot, while Desktop fake-provider E2E proves it is absent from the DOM.
   The reviewed diff introduces no logging or persistent UI configuration path for raw reasoning.
5. **Fixture/real tool boundary — pass.**
   Fixture mode uses the prototype-style static tool row. Real mode retains the expandable
   `<details>` disclosure with input/result details. Browser and Desktop fake-provider E2E cover the
   two sides.
6. **History-only and approval state — pass.**
   Agent trees default open only when a live fixture session has messages, so Cursor is open and
   history-only Hermes is closed. Fixture approval becomes single-use, changes runtime presentation,
   and appends the expected running tool row.
7. **Visual truth and thresholds unchanged — pass.**
   The candidate has no diff under `tests/visual/reference/`, `prototypes/agentos/`, or
   `tests/visual/visual-manifest.ts`. The committed reference run remains 156 cases with thresholds
   of 1px geometry, 1 color channel, 0.005 maximum pixel-difference ratio, and 0.995 minimum SSIM.
8. **No masking CSS — pass.**
   The CSS diff adds only the canned `think` animation and prototype fixture tool-row presentation;
   it does not add fixed page heights, clipping, `overflow: hidden`, scale reduction, or threshold
   exceptions.

## Verification Evidence

| Gate | Result |
|---|---|
| `pnpm --filter @dougoos/web test` | pass — 49/49 |
| `pnpm --filter @dougoos/web typecheck` | pass |
| `pnpm test:e2e` | pass — 15/15 |
| `pnpm test:visual` | pass — 9/9 in 4.0m |
| Prototype reference evidence | pass — 156 unchanged reference cases |
| Production visual evidence | pass — 171/171, comprising 155 reference-backed and 16 production-only cases |
| `pnpm check` | pass — lint, format, workspace contract, typecheck, 319 package tests, and all builds |
| `pnpm smoke:build` | pass — 8 compiled ESM entries imported |
| `git diff --exit-code HEAD -- tests/visual/reference prototypes/agentos` | pass |
| `git diff --exit-code 2852a91..373a15a -- tests/visual/reference prototypes/agentos tests/visual/visual-manifest.ts` | pass |
| Supplementary Desktop fake-provider cases | pass — real-mode tool disclosure and raw-reasoning DOM assertions |

The first restricted-sandbox browser attempt failed before executing the E2E cases because localhost
listen and Chromium Mach port access were denied. The same commands were rerun in the permitted
test environment and passed; this is environment noise, not a product finding.

## Findings

| Priority | Disposition | Finding |
|---|---|---|
| P1 | none | No blocking correctness, privacy, or visual-baseline finding. |
| P2 | none | No blocking or non-blocking task-scope finding. |
| P3 | non-blocking evidence limitation | The supplementary full `pnpm test:desktop` run required a first-run Electron binary download. After setup, both changed fake-provider cases and the secure-window case passed, but the unrelated `app.spec.ts` Core crash-recovery case exceeded its 30-second timeout. This suite is not part of `ui-regression-001` verification, the timed-out file is outside the candidate diff, and all required release gates pass. Recheck separately if Desktop E2E is promoted into the release-baseline CI gate. |

## Final Decision

The candidate satisfies `ui-regression-001`. It is eligible for task-state transition by the owning
release workflow.
