import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  recordPendingHistoryEntryIfEnabled,
  resolveOpenProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  buildInboundHistorySnapshot,
} from "openclaw/plugin-sdk";
import { resolveWxworkBotAccount } from "./accounts.js";
import { sendWxworkBotMarkdown, sendWxworkBotText } from "./api.js";
import { createWxworkBotReplyDispatcher } from "./reply-dispatcher.js";
import { getWxworkBotRuntime } from "./runtime.js";
import type { WxworkBotMessageContext } from "./types.js";

/**
 * Strip bot mention from text content.
 * WeCom messages often start with "@BotName " when mentioned in groups.
 */
function stripBotMention(text: string): string {
  // Remove leading @mention (e.g., "@RobotA hello" -> "hello")
  return text.replace(/^@\S+\s*/, "").trim();
}

export async function handleWxworkBotMessage(params: {
  cfg: ClawdbotConfig;
  msgCtx: WxworkBotMessageContext;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
  accountId: string;
}): Promise<void> {
  const { cfg, msgCtx, runtime, chatHistories, accountId } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;
  log(`wxwork-bot[${accountId}]: [DEBUG] entering handleWxworkBotMessage`);

  const core = getWxworkBotRuntime();
  log(
    `wxwork-bot[${accountId}]: [DEBUG] runtime obtained, channel keys: ${Object.keys(core.channel ?? {}).join(", ")}`,
  );

  const account = resolveWxworkBotAccount({ cfg, accountId });
  log(
    `wxwork-bot[${accountId}]: [DEBUG] account resolved, configured=${account.configured}, enabled=${account.enabled}`,
  );

  // Skip event messages (just log them)
  if (msgCtx.msgType === "event") {
    log(
      `wxwork-bot[${accountId}]: event ${msgCtx.eventType ?? "unknown"} in chat ${msgCtx.chatId}`,
    );
    return;
  }

  // Skip attachment (button click) messages for now
  if (msgCtx.msgType === "attachment") {
    log(
      `wxwork-bot[${accountId}]: attachment callback ${msgCtx.attachment?.callbackId ?? "unknown"} in chat ${msgCtx.chatId}`,
    );
    return;
  }

  // Skip command messages
  if (msgCtx.msgType === "command") {
    log(`wxwork-bot[${accountId}]: command message in chat ${msgCtx.chatId}`);
    return;
  }

  // Extract text content
  let messageText = msgCtx.textContent ?? "";

  // For image-only messages, use placeholder
  if (msgCtx.msgType === "image" && !messageText) {
    messageText = "<media:image>";
  }

  if (!messageText.trim()) {
    return;
  }

  // Strip bot mention in group chats
  const isGroup = msgCtx.chatType === "group";
  if (isGroup) {
    messageText = stripBotMention(messageText);
    if (!messageText.trim()) return;
  }

  // Access control
  const wxworkCfg = account.config;
  const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
  const { groupPolicy } = resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: cfg.channels?.["wxwork-bot"] !== undefined,
    groupPolicy: wxworkCfg?.groupPolicy,
    defaultGroupPolicy,
  });

  if (isGroup && groupPolicy === "disabled") {
    return;
  }

  if (isGroup && groupPolicy === "allowlist") {
    const groupAllowFrom = wxworkCfg?.groupAllowFrom ?? [];
    if (
      groupAllowFrom.length > 0 &&
      !groupAllowFrom.includes(msgCtx.chatId) &&
      !groupAllowFrom.includes("*")
    ) {
      return;
    }
  }

  // DM access control
  if (!isGroup) {
    const dmPolicy = wxworkCfg?.dmPolicy ?? "pairing";
    if (dmPolicy === "allowlist") {
      const allowFrom = wxworkCfg?.allowFrom ?? [];
      if (
        allowFrom.length > 0 &&
        !allowFrom.includes(msgCtx.from.userId) &&
        !allowFrom.includes("*")
      ) {
        return;
      }
    }
  }

  const senderId = msgCtx.from.userId;
  const senderName = msgCtx.from.name || msgCtx.from.alias || senderId;
  const chatId = msgCtx.chatId;
  const sessionKey = isGroup ? `wxwork-bot:group:${chatId}` : `wxwork-bot:dm:${senderId}`;

  // Build history context
  const historyLimit = isGroup
    ? (wxworkCfg?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT)
    : (wxworkCfg?.dmHistoryLimit ?? DEFAULT_GROUP_HISTORY_LIMIT);

  log(
    `wxwork-bot[${accountId}]: ${msgCtx.msgType} from ${senderName} (${senderId}) in ${msgCtx.chatType}:${chatId}`,
  );
  log(`wxwork-bot[${accountId}]: [DEBUG] received message content: "${messageText}"`);

  // Collect image URLs for media handling
  const imageUrls: string[] = [];
  if (msgCtx.imageUrl) {
    imageUrls.push(msgCtx.imageUrl);
  }
  if (msgCtx.mixedItems) {
    for (const item of msgCtx.mixedItems) {
      if (item.imageUrl) {
        imageUrls.push(item.imageUrl);
      }
    }
  }

  // Record user message in history
  recordPendingHistoryEntryIfEnabled({
    historyMap: chatHistories,
    historyKey: sessionKey,
    entry: { role: "user", content: messageText },
    limit: historyLimit,
  });

  // Resolve agent route
  const wxworkFrom = isGroup ? `wxwork-bot:group:${chatId}:${senderId}` : `wxwork-bot:${senderId}`;
  const wxworkTo = `wxwork-bot:${chatId}`;

  log(`wxwork-bot[${accountId}]: [DEBUG] resolving agent route...`);
  log(
    `wxwork-bot[${accountId}]: [DEBUG] core.channel.routing: ${typeof core.channel.routing}, keys: ${Object.keys(core.channel.routing ?? {}).join(", ")}`,
  );

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "wxwork-bot",
    accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: isGroup ? chatId : senderId,
    },
  });
  log(
    `wxwork-bot[${accountId}]: [DEBUG] route resolved: agentId=${route.agentId}, sessionKey=${route.sessionKey}`,
  );

  // Build envelope for the agent
  log(
    `wxwork-bot[${accountId}]: [DEBUG] core.channel.reply keys: ${Object.keys(core.channel.reply ?? {}).join(", ")}`,
  );

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  log(`wxwork-bot[${accountId}]: [DEBUG] envelope options resolved`);

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "wxwork-bot",
    from: wxworkFrom,
    timestamp: new Date(),
    envelope: envelopeOptions,
    body: messageText,
  });
  log(`wxwork-bot[${accountId}]: [DEBUG] agent envelope formatted`);

  let combinedBody = body;
  const historyKey = isGroup ? chatId : undefined;

  if (isGroup && historyKey && chatHistories) {
    combinedBody = buildPendingHistoryContextFromMap({
      historyMap: chatHistories,
      historyKey,
      limit: historyLimit,
      currentMessage: combinedBody,
      formatEntry: (entry) =>
        core.channel.reply.formatAgentEnvelope({
          channel: "wxwork-bot",
          from: `${chatId}:${entry.sender}`,
          timestamp: entry.timestamp,
          body: entry.body,
          envelope: envelopeOptions,
        }),
    });
  }
  log(`wxwork-bot[${accountId}]: [DEBUG] history context built`);

  const inboundHistory =
    isGroup && historyKey && historyLimit > 0 && chatHistories
      ? (chatHistories.get(historyKey) ?? []).map((entry) => ({
          sender: entry.sender,
          body: entry.body,
          timestamp: entry.timestamp,
        }))
      : undefined;

  // Determine command authorization
  log(
    `wxwork-bot[${accountId}]: [DEBUG] core.channel.commands: ${typeof core.channel.commands}, keys: ${Object.keys(core.channel.commands ?? {}).join(", ")}`,
  );

  const commandAuthorized = core.channel.commands.shouldComputeCommandAuthorized({
    cfg,
    channel: "wxwork-bot",
    accountId,
    senderId,
  });
  log(`wxwork-bot[${accountId}]: [DEBUG] commandAuthorized=${commandAuthorized}`);

  log(`wxwork-bot[${accountId}]: [DEBUG] calling finalizeInboundContext...`);
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: combinedBody,
    BodyForAgent: messageText,
    InboundHistory: inboundHistory,
    RawBody: messageText,
    CommandBody: messageText,
    From: wxworkFrom,
    To: wxworkTo,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: wxworkFrom,
    SenderName: senderName,
    SenderId: senderId,
    GroupSubject: isGroup ? chatId : undefined,
    Provider: "wxwork-bot" as const,
    Surface: "wxwork-bot" as const,
    MessageSid: msgCtx.msgId,
    Timestamp: Date.now(),
    WasMentioned: true,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: "wxwork-bot" as const,
    OriginatingTo: wxworkTo,
    ...(imageUrls.length > 0 ? { MediaUrls: imageUrls, MediaUrl: imageUrls[0] } : {}),
  });
  log(`wxwork-bot[${accountId}]: [DEBUG] inbound context finalized`);
  log(
    `wxwork-bot[${accountId}]: [DEBUG] ctxPayload.Body preview: "${String(ctxPayload.Body).slice(0, 300)}"`,
  );
  log(
    `wxwork-bot[${accountId}]: [DEBUG] ctxPayload.BodyForAgent: "${String(ctxPayload.BodyForAgent).slice(0, 300)}"`,
  );
  log(
    `wxwork-bot[${accountId}]: [DEBUG] ctxPayload.SessionKey: "${ctxPayload.SessionKey}", Provider: "${ctxPayload.Provider}", ChatType: "${ctxPayload.ChatType}"`,
  );

  // Create reply dispatcher
  log(`wxwork-bot[${accountId}]: [DEBUG] creating reply dispatcher...`);
  const { dispatcher, replyOptions, markDispatchIdle } = createWxworkBotReplyDispatcher({
    cfg,
    agentId: route.agentId,
    runtime: runtime as RuntimeEnv,
    chatId,
    webhookUrl: msgCtx.webhookUrl,
    accountId,
  });
  log(`wxwork-bot[${accountId}]: [DEBUG] reply dispatcher created`);

  try {
    log(`wxwork-bot[${accountId}]: [DEBUG] calling dispatchReplyFromConfig...`);
    let result: { queuedFinal: boolean; counts: { final: number } };
    try {
      result = await core.channel.reply.dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions,
      });
    } finally {
      dispatcher.markComplete();
      try {
        await dispatcher.waitForIdle();
      } finally {
        markDispatchIdle();
      }
    }

    if (isGroup && historyKey) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(
      `wxwork-bot[${accountId}]: dispatch complete (queuedFinal=${result.queuedFinal}, replies=${result.counts.final})`,
    );
  } catch (err) {
    error(
      `wxwork-bot[${accountId}]: failed to handle message from ${senderName}: ${err instanceof Error ? (err.stack ?? String(err)) : String(err)}`,
    );
  }
}
