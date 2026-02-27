import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getWxworkBotRuntime } from "./runtime.js";
import { sendMessageWxworkBot } from "./send.js";

export const wxworkBotOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) =>
    getWxworkBotRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4096,
  sendText: async ({ cfg, to, text, accountId }) => {
    const result = await sendMessageWxworkBot({
      cfg,
      to,
      text,
      accountId: accountId ?? undefined,
    });
    return { channel: "wxwork-bot", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    // WxWork Bot webhook doesn't support direct media upload
    // Send text + media URL as fallback
    const fullText = mediaUrl
      ? `${text ?? ""}\n📎 ${mediaUrl}`.trim()
      : (text ?? "");
    const result = await sendMessageWxworkBot({
      cfg,
      to,
      text: fullText,
      accountId: accountId ?? undefined,
    });
    return { channel: "wxwork-bot", ...result };
  },
};
