import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWxworkBotRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getWxworkBotRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WxWork Bot runtime not initialized");
  }
  return runtime;
}
