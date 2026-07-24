---
task: release-baseline-001
review: 02
base: 191511bd4fae350d2f877947a6534a81c49268ba
candidate: cb0833c3c122abe66abf1ddcc16b8b024a992d58
reviewed-at: 2026-07-24T22:34:40+08:00
result: pass
---

# release-baseline-001 Independent Review 02

## Conclusion

`pass`

Candidate `cb0833c` closes the P1 Node provenance blocker from review 01 and the P3 documentation
whitespace finding. `.nvmrc` is now the only exact release/CI Node source, the workflow consumes it
directly, and the release manifest validates and records it separately from package engine
compatibility. The manifest deterministically verifies from a clean clone with 586 release inputs.

No blocking or non-blocking finding remains open. The candidate is eligible for the owning
workflow's final administrative status update, manifest refresh, full clean-checkout gate, and
`p0-p1-mvp` tag.

## Scope

- Release task baseline: `38bfa956a1f741b7ce422035def806a57212b158`
- Review 01 commit: `191511bd4fae350d2f877947a6534a81c49268ba`
- Repair candidate: `cb0833c3c122abe66abf1ddcc16b8b024a992d58`
- Repair diff: `191511b..cb0833c`
- Full release diff reviewed across both passes: `38bfa95..cb0833c`
- Existing release tag: none; `p0-p1-mvp` does not exist
- Reviewer changed no implementation, manifest, task status, prior review, or product evidence

## Finding Closure

| Prior ID | Prior priority | Prior disposition | Review 02 result |
|---|---|---|---|
| P1-01 | P1 | blocking | **closed** — exact Node provenance now has one source and all release consumers agree |
| P3-01 | P3 | non-blocking | **closed** — the extra EOF blank line was removed and the full candidate diff passes `git diff --check` |

No new P1, P2, or P3 finding was identified.

## P1-01 Verification

1. **One exact release/CI Node source — pass.**
   `.nvmrc` contains exactly `22.23.1` followed by one newline. The repair diff removes the
   workflow's separate `22.20.0` pin; no other source or documentation file hardcodes either exact
   release version.
2. **CI consumes the source directly — pass.**
   `actions/setup-node@v4` uses `node-version-file: .nvmrc`. The workflow still starts from
   checkout and frozen-lockfile installation before running the same five release gates.
3. **Manifest generator reads and validates the source — pass.**
   `readReleaseNodeVersion()` reads `.nvmrc`, accepts only a stable three-component exact version,
   and rejects prefixes, ranges, prerelease suffixes, trailing content, or missing final newline.
   A temporary clean clone with `v22.23.1` was rejected with
   `.nvmrc must contain one exact stable Node.js version`.
4. **Exact runtime and package compatibility remain distinct — pass.**
   The generated manifest records `runtime.node` as `22.23.1` and
   `runtime.nodeEngineCompatibility` as `>=22.13.0`. The exact release runtime satisfies the
   package compatibility range.
5. **No hidden hardcoded fallback — pass.**
   The generator copies the exact runtime only from `.nvmrc`; the workflow also reads `.nvmrc`.
   Repository search outside the generated manifest, `.nvmrc`, and historical review evidence
   found no `22.23.1` or retired `22.20.0` release pin.

## Manifest and Diff Verification

1. **Current candidate check — pass.**
   `pnpm release:manifest:check` reproduces 586 inputs and SHA-256
   `2752d5038774ca494b7cd968f42493321fbaeac3328271919ac9edb19e1597d4`.
2. **Clean-clone determinism — pass.**
   A new local clone at `cb0833c` passed the manifest check. Rewriting the manifest with unchanged
   inputs produced no Git diff and retained the same 586-file result.
3. **Self-exclusion — pass.**
   The manifest remains excluded from its own source hash. Review 01 is included as a normal
   release input, explaining the candidate's change from 585 to 586 inputs.
4. **Formatting and static quality — pass.**
   The manifest tool passes ESLint; all repair files pass Prettier; the full
   `38bfa95..cb0833c` release diff passes `git diff --check`.
5. **Product and visual scope unchanged — pass.**
   The repair diff changes only release workflow, manifest tooling/output, documentation, and the
   prior EOF whitespace. No application, package, E2E, prototype, reference, or visual-test source
   changed after review 01.

## Verification Evidence

| Gate | Result |
|---|---|
| `pnpm release:manifest:check` | pass — 586 inputs / recorded SHA-256 reproduced |
| manifest rewrite with unchanged inputs | pass — no diff |
| temporary clean clone manifest check | pass |
| malformed `.nvmrc` negative probe | pass — invalid exact-version syntax rejected |
| hidden exact-Node pin search | pass — no independent hardcoded release pin |
| manifest-tool ESLint | pass |
| repair-file Prettier check | pass |
| `git diff --check 38bfa95..cb0833c` | pass |
| repair product/visual diff audit | pass — no product or visual source changed |
| review 01 full gates | pass — 319 package tests, E2E 15/15, visual 9/9, build smoke 8 imports |

The package, browser, visual, and build-smoke results are adopted from independent review 01
because the repair candidate does not modify any product, package, test, prototype, or visual
source. The owning release workflow will run the complete gate set once more from the final clean
checkout after administrative files and this review are included.

## Findings

| Priority | Disposition | Finding |
|---|---|---|
| P1 | none | No open blocking release-contract finding. |
| P2 | none | No open correctness or reproducibility finding. |
| P3 | none | No open documentation or evidence finding. |

## Finalization Boundary

This review file and the required task/README/report status updates are themselves Git-releasable
inputs. The owning workflow must:

1. commit this review;
2. update the administrative release state without changing product behavior;
3. regenerate and commit `release/p0-p1-mvp.json` after all release inputs are final;
4. run manifest check, `pnpm check`, E2E, visual regression, and build smoke from that exact clean
   checkout;
5. create `p0-p1-mvp` only if the final checkout remains green.

Any product, test-contract, visual-reference, threshold, or release-algorithm change beyond that
administrative finalization requires another independent review.

## Final Decision

`pass`

Candidate `cb0833c` is eligible pending only the final administrative status/manifest refresh,
orchestrator-owned clean-checkout verification, and `p0-p1-mvp` tag.
