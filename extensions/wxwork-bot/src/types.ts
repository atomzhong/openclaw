import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type { WxworkBotConfigSchema, z } from "./config-schema.js";

export type WxworkBotConfig = z.infer<typeof WxworkBotConfigSchema>;

/**
 * Resolved WxWork Bot account with merged config.
 */
export type ResolvedWxworkBotAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  /** The webhook URL key extracted from the full URL */
  webhookKey?: string;
  /** Token for signature verification */
  token?: string;
  /** EncodingAESKey for message encryption/decryption (base64, 43 chars) */
  encodingAesKey?: string;
  /** Merged config */
  config: WxworkBotConfig;
};

/**
 * WxWork Bot chat types.
 * - single: 单聊
 * - group: 群聊
 * - blackboard: 小黑板帖子
 * - blackboard_reply: 小黑板帖子回复
 */
export type WxworkBotChatType = "single" | "group" | "blackboard" | "blackboard_reply";

/**
 * WxWork Bot message types from callback.
 */
export type WxworkBotMsgType = "text" | "image" | "event" | "attachment" | "mixed" | "command";

/**
 * WxWork Bot event types.
 */
export type WxworkBotEventType = "add_to_chat" | "delete_from_chat" | "enter_chat";

/**
 * Parsed WxWork Bot message context (from JSON callback).
 */
export type WxworkBotMessageContext = {
  webhookUrl: string;
  msgId: string;
  chatId: string;
  postId?: string;
  chatType: WxworkBotChatType;
  from: {
    userId: string;
    name: string;
    alias: string;
  };
  getChatInfoUrl: string;
  msgType: WxworkBotMsgType;
  /** Text content (for text messages) */
  textContent?: string;
  /** Image URL (for image messages) */
  imageUrl?: string;
  /** Event type (for event messages) */
  eventType?: WxworkBotEventType;
  /** Attachment callback info (for attachment messages) */
  attachment?: {
    callbackId: string;
    actions: Array<{
      name: string;
      value: string;
      type: string;
    }>;
  };
  /** Mixed message items (for mixed messages) */
  mixedItems?: Array<{
    msgType: "text" | "image";
    textContent?: string;
    imageUrl?: string;
  }>;
};

export type WxworkBotSendResult = {
  chatId: string;
  webhookUrl: string;
};

export type WxworkBotProbeResult = BaseProbeResult<string> & {
  webhookKey?: string;
};
