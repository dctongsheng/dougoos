---
task: release-baseline-001
review: 03
base: c754fd23ecab90ce589074a1aa2ad6ba94a9c00b
candidate: b5178db8911732507f0cb4dbcd7d0b8a15509a0a
reviewed-at: 2026-07-24T23:14:23+08:00
result: pass
---

# release-baseline-001 Independent Review 03

## Conclusion

`pass`

Candidate `b5178db` closes the clean-checkout build-order blocker found after review 02. From a
second new local clone with no workspace `dist`, exact Node `22.23.1`, pnpm `11.16.0`, and a frozen
lockfile install, the root `pnpm check` completed without any manual prebuild. It ran the workspace
contract, one dependency-ordered recursive build, all eight workspace typechecks, and all 319
package tests.

No P1, P2, or P3 finding is open. The candidate is eligible for the owning workflow's final
administrative state update, release-manifest refresh, full clean-checkout gate, and
`p0-p1-mvp` tag.

## Scope

- Review 02 follow-up manifest commit: `c754fd23ecab90ce589074a1aa2ad6ba94a9c00b`
- Build-order repair candidate: `b5178db8911732507f0cb4dbcd7d0b8a15509a0a`
- Reviewed repair diff: `c754fd2..b5178db`
- Existing release tag: none; `p0-p1-mvp` does not exist
- Reviewer changed no implementation, manifest, task status, prior review, or product evidence

The repair changes only `package.json`, release documentation, and the generated manifest. It does
not change application, package implementation, test, E2E, prototype, visual-reference, workflow,
or release-manifest generator source.

## Build-Order Blocker Closure

1. **Root check builds before typecheck and tests — pass.**
   `package.json:14` now runs lint, format, and `check:workspace`, then `pnpm -r build`, followed by
   `pnpm -r typecheck` and `pnpm -r test`. The old order at `c754fd2` ran typecheck and tests before
   the build and therefore depended on workspace output left by an earlier command.
2. **The build is dependency ordered — pass.**
   The clean-clone output first built `@dougoos/shared`; then ACP, storage, Web, and Cloud; then
   providers; then Core; and finally Desktop. This matches the acyclic workspace graph validated by
   `tooling/check-workspace.mjs` and demonstrates that consumers were not built before their
   workspace dependencies.
3. **No stored build output is required — pass.**
   Both new clones contained zero `apps/**/dist` or `packages/**/dist` directories before install.
   Frozen install also left that count at zero. The passing check therefore created all required
   workspace output itself.
4. **Typecheck was not skipped — pass.**
   After the recursive build, the passing run executed and completed typecheck for all eight
   dynamically discovered packages before starting package tests.
5. **There is no duplicate final workspace build — pass.**
   The root script contains exactly one `pnpm -r build` and ends with `pnpm -r test`; the previous
   trailing recursive build was moved rather than copied. `@dougoos/storage` retains its existing
   package-local `test` prebuild, but that does not repeat the final eight-package workspace build.

## Workflow Verification

`.github/workflows/clean-checkout.yml` is unchanged by the repair and still:

1. checks out the repository;
2. reads exact Node from `.nvmrc`;
3. activates pinned pnpm `11.16.0`;
4. installs with `pnpm install --frozen-lockfile`;
5. installs pinned Chromium and verifies the manifest;
6. calls the root `pnpm check` directly, without inserting a compensating manual build;
7. continues to E2E, visual regression, and build smoke.

The root script is therefore the single owner of the clean-checkout package build/typecheck/test
order used by both local release verification and CI.

## Exact-Node Clean-Clone Evidence

The passing verification used:

```text
Node binary:
/private/tmp/dougoos-release-node.0QJSvA/node-v22.23.1-darwin-arm64/bin/node
Node: v22.23.1
pnpm: 11.16.0
clone: /private/tmp/dougoos-release-rereview03b.ktn0zW/repo
HEAD: b5178db8911732507f0cb4dbcd7d0b8a15509a0a
workspace dist before install: 0
workspace dist after frozen install: 0
workspace dist before pnpm check: 0
```

No build command ran between frozen install and `pnpm check`. The direct check passed:

| Stage | Result |
|---|---|
| lint | pass |
| Prettier check | pass |
| workspace contract | pass — 8 ESM packages, acyclic graph |
| dependency-ordered workspace build | pass — all 8 packages |
| workspace typecheck | pass — all 8 packages |
| package tests | pass — 319/319 |

The frozen install printed expected workspace-bin warnings because the ACP CLI target did not yet
exist in `dist`; the install still completed successfully and the subsequent zero-`dist` audit
confirmed it had not performed a hidden build.

## Manifest and Documentation Verification

1. **Manifest check — pass.**
   The passing clean clone reproduced 587 release inputs and SHA-256
   `710548f6a2629dd4976b824baa1ff558749f84336f27cc8b8ed83e336438a990`.
2. **Runtime and summary — pass.**
   The manifest still records exact Node `22.23.1`, Node compatibility `>=22.13.0`, pnpm
   `pnpm@11.16.0`, eight packages, and 319 passing package tests.
3. **Git cleanliness — pass.**
   After frozen install, the direct check, and manifest verification, `git status --porcelain`
   returned zero entries; generated build output remained ignored.
4. **Documentation agreement — pass.**
   `README.md`, `plan.md`, `docs/VALIDATION_REPORT.md`, and
   `docs/plan/analysis/p1-release-baseline.md` consistently describe one topology build before all
   typechecks/tests, no dependency on old `dist`, review 02 as passed, this repair as awaiting
   exact-Node review, the task as `in-progress`, and the tag as not yet created.
5. **Diff quality — pass.**
   `git diff --check c754fd2..b5178db` reports no whitespace error.

## Execution Observation

A first separate new clone also started with zero workspace `dist` under exact Node `22.23.1` and
reached the package-test phase, but the existing ACP REPL test missed its one-second readiness
window once. An immediate isolated rerun passed 27/27 ACP tests. The second independent new clone
then passed the complete direct root check under the normal permitted execution environment with
319/319 tests. No implementation was changed between runs. This transient restricted-environment
timing observation is recorded for auditability but is not an open release finding.

## Findings

| Priority | Disposition | Finding |
|---|---|---|
| P1 | none | No open build-order, clean-checkout, or release-contract blocker. |
| P2 | none | No open correctness or reproducibility finding. |
| P3 | none | No open documentation, manifest, or evidence finding. |

## Finalization Boundary

Committing this review adds one Git-releasable input and will correctly make the current manifest
stale. The owning release workflow must:

1. commit this review;
2. update the task, plan index, README, and validation-report administrative state;
3. regenerate and commit `release/p0-p1-mvp.json` after all release inputs are final;
4. run manifest check, `pnpm check`, E2E, visual regression, and build smoke from that exact final
   clean checkout;
5. create `p0-p1-mvp` only if the final checkout remains green.

Any product, test-contract, visual-reference, threshold, workspace-order algorithm, or
release-manifest algorithm change beyond administrative finalization requires another independent
review.

## Final Decision

`pass`

Candidate `b5178db` is eligible pending only final administrative state, manifest refresh,
orchestrator-owned clean-checkout verification, and the `p0-p1-mvp` tag.
