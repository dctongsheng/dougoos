# Package smoke replacement contract

`pnpm smoke:package` builds and launches the current development machine's unsigned
Electron artifact. Importing TypeScript output is only a build smoke and is covered by
`pnpm smoke:build`.

The desktop smoke:

1. builds the current development machine's unsigned Electron artifact;
2. launches that artifact rather than source files or a browser substitute;
3. waits for the Core ready handshake and verifies the BrowserWindow loads;
4. proves packaged native/runtime dependencies can load; and
5. closes the application and confirms its process tree exits.

The smoke also enables the explicit test-only Fake Provider, creates a Session and an
active delayed Turn, then proves application shutdown closes the fixture and the full
process tree.
