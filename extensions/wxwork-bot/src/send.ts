import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { sendWxworkBotMarkdown, sendWxworkBotText } from "./api.js";
import type { WxworkBotSendResult } from "./types.js";

export type SendWxworkBotMessageParams = {
  cfg: ClawdbotConfig;
  /** Target: the webhook URL for the chat */
  to: string;
  text: string;
  accountId?: string;
};

/**
 * Send a text message to a WxWork Bot chat via webhook URL.
 * The "to" parameter is the webhook URL.
 */
export async function sendMessageWxworkBot(
  params: SendWxworkBotMessageParams,
): Promise<WxworkBotSendResult> {
  const { to, text } = params;

  // Use markdown for richer formatting
  await sendWxworkBotMarkdown({
    webhookUrl: to,
    content: text,
  });

  return {
    chatId: "",
    webhookUrl: to,
  };
}

/**
 * Send a plain text message to a WxWork Bot chat.
 */
export async function sendTextWxworkBot(
  params: SendWxworkBotMessageParams & {
    mentionedList?: string[];
  },
): Promise<WxworkBotSendResult> {
  const { to, text, mentionedList } = params;

  await sendWxworkBotText({
    webhookUrl: to,
    content: text,
    mentionedList,
  });

  return {
    chatId: "",
    webhookUrl: to,
  };
}
