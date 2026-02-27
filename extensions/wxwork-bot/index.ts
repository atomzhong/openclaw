import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { wxworkBotPlugin } from "./src/channel.js";
import { setWxworkBotRuntime } from "./src/runtime.js";

const plugin = {
  id: "wxwork-bot",
  name: "WxWork Bot",
  description: "WxWork Bot (企业微信机器人) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWxworkBotRuntime(api.runtime);
    api.registerChannel({ plugin: wxworkBotPlugin });
  },
};

export default plugin;
