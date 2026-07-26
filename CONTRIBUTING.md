# Contributing to DougoOS

Thank you for improving DougoOS.

## License of contributions

By submitting a contribution, you certify that you have the right to submit it and agree that it
will be licensed under `AGPL-3.0-only`, unless a file is clearly identified as third-party material
under different terms. Do not copy proprietary code or credentials into the repository.

## Development

Use the exact Node.js version from `.nvmrc` and pnpm `11.16.0`:

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
pnpm test:visual
pnpm smoke:build
```

Changes that affect packaged behavior should also pass `pnpm smoke:package` on macOS Apple Silicon.
Visual changes must update the canonical macOS 14 evidence through the repository workflow.

For vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
