import { delimiter, dirname } from "node:path";

import type { SanitizedProcessEnv } from "@dougoos/acp";

export const COMMON_PROCESS_ENV = [
  "ALL_PROXY",
  "COMSPEC",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export const CODEX_PROCESS_ENV = [
  "CODEX_API_KEY",
  "CODEX_CONFIG",
  "CODEX_HOME",
  "CODEX_PATH",
  "NO_BROWSER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

const MODEL_PROVIDER_PROCESS_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "KIMI_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "ZAI_API_KEY",
] as const;

export const CURSOR_PROCESS_ENV = [
  "CURSOR_AGENT_EXECUTABLE",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
  "CURSOR_CONFIG_DIR",
  "CURSOR_ENDPOINT",
  "NO_OPEN_BROWSER",
] as const;

export const GROK_PROCESS_ENV = [
  "GROK_BIN",
  "GROK_CONFIG_PATH",
  "GROK_HOME",
  "GROK_WS_ORIGIN",
  "GROK_WS_URL",
  "NO_BROWSER",
  "XAI_API_KEY",
] as const;

export const HERMES_PROCESS_ENV = [
  ...MODEL_PROVIDER_PROCESS_ENV,
  "HERMES_BIN",
  "HERMES_HOME",
  "HERMES_INFERENCE_MODEL",
  "HERMES_INFERENCE_PROVIDER",
  "NO_BROWSER",
] as const;

export const OPENCODE_PROCESS_ENV = [
  ...MODEL_PROVIDER_PROCESS_ENV,
  "OPENCODE_API_KEY",
  "OPENCODE_BIN",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
] as const;

export const OPENCLAW_PROCESS_ENV = [
  ...MODEL_PROVIDER_PROCESS_ENV,
  "OPENCLAW_BIN",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_STATE_DIR",
] as const;

export const PI_PROCESS_ENV = [
  ...MODEL_PROVIDER_PROCESS_ENV,
  "AI_GATEWAY_API_KEY",
  "CEREBRAS_API_KEY",
  "FIREWORKS_API_KEY",
  "MINIMAX_API_KEY",
  "NVIDIA_API_KEY",
  "OPENCODE_API_KEY",
  "PI_ACP_ENABLE_EMBEDDED_CONTEXT",
  "PI_ACP_PI_COMMAND",
  "PI_BIN",
  "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR",
  "PI_OFFLINE",
  "PI_PACKAGE_DIR",
  "PI_TELEMETRY",
] as const;

export function pickEnvironment(
  environment: NodeJS.ProcessEnv | SanitizedProcessEnv,
  names: readonly string[],
): SanitizedProcessEnv {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

export function prependExecutableDirectory(
  environment: SanitizedProcessEnv,
  executablePath: string,
): SanitizedProcessEnv {
  const directory = dirname(executablePath);
  const directories = (environment.PATH ?? "").split(delimiter).filter(Boolean);
  return {
    ...environment,
    PATH: [directory, ...directories.filter((candidate) => candidate !== directory)].join(
      delimiter,
    ),
  };
}

const LOOPBACK_PROXY_BYPASS = ["127.0.0.1", "localhost", "::1"] as const;

/**
 * ACP CLIs may host an internal HTTP service or connect to a loopback Gateway.
 * Keep those requests local even when the parent desktop process inherited a
 * system proxy without a NO_PROXY setting.
 */
export function withLoopbackProxyBypass(environment: SanitizedProcessEnv): SanitizedProcessEnv {
  const bypasses = [
    ...(environment.NO_PROXY ?? "").split(","),
    ...(environment.no_proxy ?? "").split(","),
    ...LOOPBACK_PROXY_BYPASS,
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const value = [...new Set(bypasses)].join(",");
  return {
    ...environment,
    NO_PROXY: value,
    no_proxy: value,
  };
}

/**
 * Captures only variables that a concrete Provider may subsequently choose to
 * pass to its child. Doctor results never include this object or its values.
 */
export function providerProcessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SanitizedProcessEnv {
  return pickEnvironment(environment, [
    ...COMMON_PROCESS_ENV,
    ...CODEX_PROCESS_ENV,
    ...CURSOR_PROCESS_ENV,
    ...GROK_PROCESS_ENV,
    ...HERMES_PROCESS_ENV,
    ...OPENCODE_PROCESS_ENV,
    ...OPENCLAW_PROCESS_ENV,
    ...PI_PROCESS_ENV,
  ]);
}
