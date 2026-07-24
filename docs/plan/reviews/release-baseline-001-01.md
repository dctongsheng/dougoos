---
task: release-baseline-001
review: 01
base: 38bfa956a1f741b7ce422035def806a57212b158
candidate: 9f963eaef8bae7a222edcf4ead04bc401157453c
reviewed-at: 2026-07-24T22:18:55+08:00
result: blocked
---

# release-baseline-001 Independent Review 01

## Conclusion

`blocked`

The release candidate passes the repository hygiene audit, manifest recomputation, package checks,
browser E2E, visual regression, and build smoke. The preceding `ui-regression-001` blocker is also
closed by an independent passing review. However, the release manifest does not record an exact
Node version and the repository currently has two different exact Node pins. This violates
requirement 7 and blocks the release baseline.

The candidate is **not eligible** for the final clean-checkout gate or the `p0-p1-mvp` tag until the
P1 finding below is fixed and independently re-reviewed.

## Scope

- Seed: `0fd4b38` (`origin/main` when the task was created)
- Task baseline: `38bfa956a1f741b7ce422035def806a57212b158`
- Candidate: `9f963eaef8bae7a222edcf4ead04bc401157453c`
- Reviewed diff: `38bfa95..9f963ea`
- Branch: `task/release-baseline-001`
- Existing release tag: none; `p0-p1-mvp` does not exist
- Reviewer changed no implementation, manifest, task status, or product evidence

## Requirement Review

1. **P0/P1 product state is separated from release state — pass.**
   `plan.md`, `README.md`, `docs/VALIDATION_REPORT.md`, and the delivery-plan index consistently
   describe the product checkpoint as verified while leaving `release-baseline-001` `in-progress`,
   pending this review and a tag.
2. **Project metadata and evidence counts — pass.**
   The root project is `dougoos` version `0.1.0` with a current local-first desktop AgentOS
   description. The recorded 319 package tests, 15 E2E tests, 156 prototype references, 155
   production reference cases, 16 production-only cases, 171 total production cases, and 8 build
   smoke imports match current source manifests and this review run.
3. **Generated and sensitive local outputs stay out of Git — pass.**
   `.artifacts/` (about 1.4GB), `tests/visual/production/` (about 75MB), Playwright output,
   databases and journals, logs, Provider diagnostics, and Wrangler state are ignored. No matching
   path is tracked in the candidate index.
4. **Required reference evidence remains versioned — pass.**
   Git tracks 156 prototype reference screenshots and 156 matching metadata files. The candidate
   does not change `tests/visual/reference/` or `prototypes/agentos/`.
5. **Clean-checkout workflow shape — pass, final full run pending remediation.**
   The workflow checks out the repository, pins pnpm, installs with `--frozen-lockfile`, installs
   the lockfile-pinned Chromium, then runs manifest check, `pnpm check`, browser E2E, visual
   regression, and build smoke. A temporary local clean clone completed the frozen install,
   manifest check, and workspace check. The owning workflow intentionally retains the final full
   clean-checkout run until after review findings are resolved.
6. **No credentialed or external mutation path in CI — pass.**
   The workflow does not set the real-Provider flag, run Provider doctor/smoke, sign/notarize the
   desktop app, or perform an actual Cloudflare deployment. Cloud builds use
   `wrangler deploy --dry-run`; the reviewed runs exited at the dry-run boundary without publishing
   or requiring Cloudflare credentials.
7. **Manifest schema, versions, and test summary — blocked.**
   Schema, release name, project version, pnpm, Chromium, dependency versions, source count/hash,
   and all test summaries are present and accurate. The Node entry is not an actual version and
   disagrees with the repository/workflow pins; see finding P1-01.
8. **Manifest hash determinism and self-exclusion — pass for the candidate inputs.**
   Inputs are NUL-delimited from Git, sorted bytewise, and hashed with path length, path, type,
   content length, and content. `release/p0-p1-mvp.json` is explicitly excluded. The current
   candidate deterministically verifies as 585 release inputs with SHA-256
   `f774fcd24dd8b2961646e734df091764d07fbc111677357b6aa0387199238a1b`; rewriting the
   manifest with unchanged inputs produced no diff.
9. **Task state remains reviewer-owned — pass.**
   `release-baseline-001` remains `in-progress`; no tag was created prematurely.
10. **Approval test contract was not weakened — pass.**
    The candidate separately asserts the visible approval command, collapsed tool preview,
    hidden-before-expand tool input, and visible-after-expand input. The prior independent UI
    review also confirms fixture/real boundaries and raw-reasoning privacy without changed
    references or thresholds.
11. **Blocking UI dependency is closed — pass.**
    `ui-regression-001` is `done`, independent review 01 is `pass`, visual regression is 9/9, and
    the 156 committed reference inputs remain unchanged.

## Verification Evidence

| Gate | Result |
|---|---|
| `git check-ignore` and tracked-index audit | pass — generated, diagnostic, DB, log, and Wrangler paths ignored and untracked |
| tracked large-file audit | pass — no blob exceeds 100MB; largest tracked blob is about 9.1MB |
| reference input audit | pass — 156 screenshots plus 156 metadata files tracked |
| `pnpm release:manifest:check` | pass — 585 inputs / recorded SHA-256 reproduced |
| manifest deterministic rewrite | pass — unchanged inputs produced no manifest diff |
| temporary clean clone `pnpm install --frozen-lockfile` | pass — lockfile current; pnpm 11.16.0 |
| temporary clean clone manifest/workspace checks | pass |
| `pnpm check` | pass — lint, format, workspace contract, typecheck, 319 package tests, all builds |
| `pnpm test:e2e` | pass — 15/15 |
| `pnpm test:visual` | pass — 9/9 in 4.0m; 156 prototype and 171 production cases |
| `pnpm smoke:build` | pass — 8 compiled ESM entries imported |
| reference/prototype diff audit | pass — no candidate changes |
| UI blocker review | pass — `ui-regression-001-01.md` |

The first restricted-sandbox `pnpm check` attempt could not bind `127.0.0.1` and failed with
`EPERM`. The same command was rerun in the permitted test environment and passed. The offline-only
temporary install probe also lacked one cached registry tarball; the task's actual clean-checkout
command, `pnpm install --frozen-lockfile`, then completed successfully. Both are environment
observations, not product findings.

## Findings

| ID | Priority | Disposition | Finding |
|---|---|---|---|
| P1-01 | P1 | **blocking** | Requirement 7 requires the manifest to record the Node version. Instead, `release/p0-p1-mvp.json` records the compatibility range `>=22.13.0`, because the generator copies `package.json#engines.node`. This is not the release runtime version. In addition, `.nvmrc` pins `22.23.1` while `clean-checkout.yml` pins `22.20.0`, so there is no single exact Node release version to reproduce or audit. Select one exact Node version as the source of truth, align `.nvmrc`, CI, and manifest generation/output, regenerate the manifest, and rerun independent review before the final clean checkout and tag. |
| P3-01 | P3 | non-blocking | `git diff --check 38bfa95..9f963ea` reports one new blank line at EOF in `docs/plan/analysis/ui-regression-release-blocker.md`. Required format and release gates pass, so this is documentation whitespace only. |

No P2 finding was identified.

## Release Sequencing Note

The review file is itself a Git-releasable input, so committing this review will correctly make the
candidate manifest stale. After P1-01 is fixed and the follow-up review is committed, the owning
release workflow must regenerate the manifest, run all gates from that final clean checkout, and
only then create `p0-p1-mvp`. This note does not relax the requirement for a passing follow-up
independent review.

## Final Decision

`blocked`

Candidate `9f963ea` is not eligible for task completion, merge, or tag. A follow-up candidate must
close P1-01, preserve the passing hygiene/UI/test evidence, receive a new independent review, and
then pass the orchestrator's final full clean-checkout gate.
