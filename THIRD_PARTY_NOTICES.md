# Third-Party Software Notices

DougoOS original source code is licensed under `AGPL-3.0-only`. That license does not replace the
licenses or terms of third-party software used, referenced, or distributed with DougoOS.

## Packaged components

- Electron and Chromium retain their upstream licenses and notices. The macOS package includes
  Electron's `LICENSE` and `LICENSES.chromium.html`.
- Instrument Sans and JetBrains Mono retain the SIL Open Font License 1.1. Their complete
  copyright and license texts are included in the website and desktop package.
- The Cloud and desktop frontend bundles include React, ReactDOM, Scheduler, react-markdown,
  remark, unified, Vite runtime code, and their required transitive packages. Their complete
  upstream license and notice files are collected in
  `legal/FRONTEND_THIRD_PARTY_LICENSES.txt` in the source tree and
  `FRONTEND_THIRD_PARTY_LICENSES.txt` beside this notice in packaged legal directories.
- DougoOS 0.2.0 keeps its **Claude Agent** product slot fail-closed and unavailable. This release
  does not distribute or launch `@agentclientprotocol/claude-agent-acp`,
  `@anthropic-ai/claude-agent-sdk`, or an Anthropic platform binary.
- The desktop package distributes `@openai/codex@0.145.0` and its
  `@openai/codex-darwin-arm64@0.145.0-darwin-arm64` platform package under Apache-2.0. Because
  those npm archives omit the repository legal files, the desktop package includes the exact
  `LICENSE` and `NOTICE` from the official
  [`rust-v0.145.0` source tag](https://github.com/openai/codex/tree/rust-v0.145.0).
- Other npm dependencies retain the license declared by their respective package metadata and,
  where supplied upstream, their license files are retained alongside the packaged modules.

## Reference material

`references/pi` is a separate upstream Git submodule and retains the MIT license stored inside that
submodule. Generated Cloudflare type declarations retain their embedded Cloudflare and Microsoft
notices.

Nothing in this notice grants trademark rights or changes any third-party license or service term.
