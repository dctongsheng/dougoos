import { app, BrowserWindow } from "electron";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'"
    />
    <title>DougoOS Desktop Harness</title>
    <style>
      body {
        background: #0b0f14;
        color: #f3f6f8;
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 32px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1 data-testid="title">DougoOS Desktop Harness</h1>
      <output data-testid="status">browserwindow-ready</output>
    </main>
  </body>
</html>`;

void app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      height: 480,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
      width: 720,
    });

    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  })
  .catch((error) => {
    console.error("Electron harness startup failed", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  app.quit();
});
