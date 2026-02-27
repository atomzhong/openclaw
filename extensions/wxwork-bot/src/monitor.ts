import * as http from "node:http";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { installRequestBodyLimitGuard } from "openclaw/plugin-sdk";
import { resolveWxworkBotAccount, listEnabledWxworkBotAccounts } from "./accounts.js";
import { handleWxworkBotMessage } from "./bot.js";
import { verifySignature, decryptMessage, computeMsgSignature } from "./crypto.js";
import type { ResolvedWxworkBotAccount, WxworkBotMessageContext } from "./types.js";

export type MonitorWxworkBotOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

const httpServers = new Map<string, http.Server>();
const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const WEBHOOK_BODY_TIMEOUT_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimits = new Map<string, { count: number; windowStartMs: number }>();

function isRateLimited(key: string, nowMs: number): boolean {
  const state = rateLimits.get(key);
  if (!state || nowMs - state.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { count: 1, windowStartMs: nowMs });
    return false;
  }
  state.count += 1;
  return state.count > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Parse JSON callback body into WxworkBotMessageContext.
 */
function parseJsonCallback(data: Record<string, unknown>): WxworkBotMessageContext {
  const from = data.from as Record<string, string> | undefined;
  const ctx: WxworkBotMessageContext = {
    webhookUrl: String(data.webhook_url ?? ""),
    msgId: String(data.msgid ?? ""),
    chatId: String(data.chatid ?? ""),
    postId: data.postid ? String(data.postid) : undefined,
    chatType: (data.chattype as WxworkBotMessageContext["chatType"]) ?? "group",
    from: {
      userId: from?.userid ?? "",
      name: from?.name ?? "",
      alias: from?.alias ?? "",
    },
    getChatInfoUrl: String(data.get_chat_info_url ?? ""),
    msgType: (data.msgtype as WxworkBotMessageContext["msgType"]) ?? "text",
  };

  switch (ctx.msgType) {
    case "text": {
      const text = data.text as Record<string, string> | undefined;
      ctx.textContent = text?.content ?? "";
      break;
    }
    case "image": {
      const image = data.image as Record<string, string> | undefined;
      ctx.imageUrl = image?.image_url ?? "";
      break;
    }
    case "event": {
      const event = data.event as Record<string, string> | undefined;
      ctx.eventType = (event?.event_type as WxworkBotMessageContext["eventType"]) ?? undefined;
      break;
    }
    case "attachment": {
      const att = data.attachment as Record<string, unknown> | undefined;
      if (att) {
        ctx.attachment = {
          callbackId: String(att.callbackid ?? ""),
          actions: Array.isArray(att.actions)
            ? (att.actions as Array<Record<string, string>>).map((a) => ({
                name: a.name ?? "",
                value: a.value ?? "",
                type: a.type ?? "button",
              }))
            : [],
        };
      }
      break;
    }
    case "mixed": {
      const mixed = data.mixed_message as Record<string, unknown> | undefined;
      const items = mixed?.msg_item;
      if (Array.isArray(items)) {
        ctx.mixedItems = (items as Array<Record<string, unknown>>).map((item) => {
          const msgType = (item.msg_type as string) === "image" ? "image" : "text";
          if (msgType === "image") {
            const img = item.image as Record<string, string> | undefined;
            return { msgType, imageUrl: img?.image_url };
          }
          const txt = item.text as Record<string, string> | undefined;
          return { msgType, textContent: txt?.content };
        });
        // Also extract combined text content from mixed items
        const textParts = ctx.mixedItems
          .filter((i) => i.msgType === "text" && i.textContent)
          .map((i) => i.textContent!);
        if (textParts.length > 0) {
          ctx.textContent = textParts.join("\n");
        }
      }
      break;
    }
  }

  return ctx;
}

/**
 * Parse XML callback body into WxworkBotMessageContext.
 * Simple regex-based XML parser for WeCom callback format.
 */
function parseXmlCallback(xml: string): WxworkBotMessageContext {
  const getTag = (tag: string, src: string): string => {
    const cdataMatch = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`).exec(
      src,
    );
    if (cdataMatch) return cdataMatch[1] ?? "";
    const simpleMatch = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(src);
    return simpleMatch?.[1]?.trim() ?? "";
  };

  const fromBlock = /<From>([\s\S]*?)<\/From>/.exec(xml)?.[1] ?? "";

  const ctx: WxworkBotMessageContext = {
    webhookUrl: getTag("WebhookUrl", xml),
    msgId: getTag("MsgId", xml),
    chatId: getTag("ChatId", xml),
    postId: getTag("PostId", xml) || undefined,
    chatType: (getTag("ChatType", xml) as WxworkBotMessageContext["chatType"]) || "group",
    from: {
      userId: getTag("UserId", fromBlock),
      name: getTag("Name", fromBlock),
      alias: getTag("Alias", fromBlock),
    },
    getChatInfoUrl: getTag("GetChatInfoUrl", xml),
    msgType: (getTag("MsgType", xml) as WxworkBotMessageContext["msgType"]) || "text",
  };

  switch (ctx.msgType) {
    case "text": {
      const textBlock = /<Text>([\s\S]*?)<\/Text>/.exec(xml)?.[1] ?? "";
      ctx.textContent = getTag("Content", textBlock);
      break;
    }
    case "image": {
      const imageBlock = /<Image>([\s\S]*?)<\/Image>/.exec(xml)?.[1] ?? "";
      ctx.imageUrl = getTag("ImageUrl", imageBlock);
      break;
    }
    case "event": {
      const eventBlock = /<Event>([\s\S]*?)<\/Event>/.exec(xml)?.[1] ?? "";
      ctx.eventType =
        (getTag("EventType", eventBlock) as WxworkBotMessageContext["eventType"]) || undefined;
      break;
    }
    case "attachment": {
      const attBlock = /<Attachment>([\s\S]*?)<\/Attachment>/.exec(xml)?.[1] ?? "";
      ctx.attachment = {
        callbackId: getTag("CallbackId", attBlock),
        actions: [],
      };
      const actionsMatch = /<Actions>([\s\S]*?)<\/Actions>/g;
      let m;
      while ((m = actionsMatch.exec(attBlock)) !== null) {
        const actionXml = m[1] ?? "";
        ctx.attachment.actions.push({
          name: getTag("Name", actionXml),
          value: getTag("Value", actionXml),
          type: getTag("Type", actionXml) || "button",
        });
      }
      break;
    }
    case "mixed": {
      const mixedBlock = /<MixedMessage>([\s\S]*?)<\/MixedMessage>/.exec(xml)?.[1] ?? "";
      const itemRegex = /<MsgItem>([\s\S]*?)<\/MsgItem>/g;
      ctx.mixedItems = [];
      let im;
      while ((im = itemRegex.exec(mixedBlock)) !== null) {
        const itemXml = im[1] ?? "";
        const itemType = getTag("MsgType", itemXml);
        if (itemType === "image") {
          const imgBlock = /<Image>([\s\S]*?)<\/Image>/.exec(itemXml)?.[1] ?? "";
          ctx.mixedItems.push({
            msgType: "image",
            imageUrl: getTag("ImageUrl", imgBlock),
          });
        } else {
          const txtBlock = /<Text>([\s\S]*?)<\/Text>/.exec(itemXml)?.[1] ?? "";
          ctx.mixedItems.push({
            msgType: "text",
            textContent: getTag("Content", txtBlock),
          });
        }
      }
      const textParts = ctx.mixedItems
        .filter((i) => i.msgType === "text" && i.textContent)
        .map((i) => i.textContent!);
      if (textParts.length > 0) {
        ctx.textContent = textParts.join("\n");
      }
      break;
    }
  }

  return ctx;
}

/**
 * Monitor a single WxWork Bot account via webhook HTTP server.
 */
async function monitorSingleAccount(params: {
  cfg: ClawdbotConfig;
  account: ResolvedWxworkBotAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, account, runtime, abortSignal } = params;
  const { accountId } = account;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const port = account.config.webhookPort ?? 3000;
  const path = account.config.webhookPath ?? "/wxwork-bot/callback";
  const host = account.config.webhookHost ?? "127.0.0.1";
  const callbackFormat = account.config.callbackFormat ?? "json";
  const chatHistories = new Map<string, HistoryEntry[]>();
  // Track processed message IDs for dedup
  const processedMsgIds = new Set<string>();
  const DEDUP_TTL_MS = 5 * 60 * 1000;

  log(
    `wxwork-bot[${accountId}]: starting webhook server on ${host}:${port}${path} (format: ${callbackFormat})`,
  );

  const server = http.createServer();

  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== path) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const rateLimitKey = `${accountId}:${req.socket.remoteAddress ?? "unknown"}`;
    if (isRateLimited(rateLimitKey, Date.now())) {
      res.statusCode = 429;
      res.end("Too Many Requests");
      return;
    }

    const msgSignature = url.searchParams.get("msg_signature") ?? "";
    const timestamp = url.searchParams.get("timestamp") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";

    // GET: URL validation
    if (req.method === "GET") {
      const echostr = url.searchParams.get("echostr") ?? "";
      if (!echostr || !account.token || !account.encodingAesKey) {
        res.statusCode = 400;
        res.end("Bad Request");
        return;
      }

      // Verify signature
      if (
        !verifySignature({
          msgSignature,
          timestamp,
          nonce,
          encrypt: echostr,
          token: account.token,
        })
      ) {
        res.statusCode = 401;
        res.end("Invalid Signature");
        return;
      }

      // Decrypt echostr to get the msg
      try {
        const decrypted = decryptMessage(echostr, account.encodingAesKey);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(decrypted);
        log(`wxwork-bot[${accountId}]: URL validation succeeded`);
      } catch (err) {
        error(`wxwork-bot[${accountId}]: URL validation decrypt failed: ${String(err)}`);
        res.statusCode = 500;
        res.end("Decrypt Failed");
      }
      return;
    }

    // POST: message callback
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    const guard = installRequestBodyLimitGuard(req, res, {
      maxBytes: WEBHOOK_MAX_BODY_BYTES,
      timeoutMs: WEBHOOK_BODY_TIMEOUT_MS,
      responseFormat: "text",
    });
    if (guard.isTripped()) return;

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      guard.dispose();
      const rawBody = Buffer.concat(chunks).toString("utf8");

      try {
        // Extract encrypted content
        let encryptedContent: string;
        if (callbackFormat === "json") {
          const json = JSON.parse(rawBody) as Record<string, unknown>;
          encryptedContent = String(json.encrypt ?? "");
        } else {
          // XML format
          const match = /<Encrypt>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Encrypt>/.exec(rawBody);
          encryptedContent = match?.[1] ?? "";
        }

        if (!encryptedContent) {
          res.statusCode = 400;
          res.end("Missing encrypted content");
          return;
        }

        // Verify signature
        if (
          !verifySignature({
            msgSignature,
            timestamp,
            nonce,
            encrypt: encryptedContent,
            token: account.token!,
          })
        ) {
          res.statusCode = 401;
          res.end("Invalid Signature");
          return;
        }

        // Decrypt
        const decrypted = decryptMessage(encryptedContent, account.encodingAesKey!);

        // Parse the decrypted message
        let msgCtx: WxworkBotMessageContext;
        if (callbackFormat === "json") {
          msgCtx = parseJsonCallback(JSON.parse(decrypted) as Record<string, unknown>);
        } else {
          msgCtx = parseXmlCallback(decrypted);
        }

        // Dedup by msgId
        if (msgCtx.msgId && processedMsgIds.has(msgCtx.msgId)) {
          res.statusCode = 200;
          res.end("");
          return;
        }
        if (msgCtx.msgId) {
          processedMsgIds.add(msgCtx.msgId);
          setTimeout(() => processedMsgIds.delete(msgCtx.msgId), DEDUP_TTL_MS);
        }

        // Respond immediately with 200 to avoid WeCom retries
        res.statusCode = 200;
        res.end("");

        // Handle message async (fire-and-forget)
        handleWxworkBotMessage({
          cfg,
          msgCtx,
          runtime,
          chatHistories,
          accountId,
        }).catch((err) => {
          error(
            `wxwork-bot[${accountId}]: error handling message: ${err instanceof Error ? (err.stack ?? String(err)) : String(err)}`,
          );
        });
      } catch (err) {
        error(`wxwork-bot[${accountId}]: callback processing error: ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Error");
        }
      }
    });
  });

  httpServers.set(accountId, server);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.close();
      httpServers.delete(accountId);
    };

    const handleAbort = () => {
      log(`wxwork-bot[${accountId}]: abort signal received, stopping webhook server`);
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    server.listen(port, host, () => {
      log(`wxwork-bot[${accountId}]: webhook server listening on ${host}:${port}`);
    });

    server.on("error", (err) => {
      error(`wxwork-bot[${accountId}]: webhook server error: ${err}`);
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    });
  });
}

/**
 * Main entry: start monitoring for all enabled accounts.
 */
export async function monitorWxworkBotProvider(opts: MonitorWxworkBotOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for WxWork Bot monitor");
  }

  const log = opts.runtime?.log ?? console.log;

  if (opts.accountId) {
    const account = resolveWxworkBotAccount({
      cfg,
      accountId: opts.accountId,
    });
    if (!account.enabled || !account.configured) {
      throw new Error(`WxWork Bot account "${opts.accountId}" not configured or disabled`);
    }
    return monitorSingleAccount({
      cfg,
      account,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
    });
  }

  const accounts = listEnabledWxworkBotAccounts(cfg);
  if (accounts.length === 0) {
    throw new Error("No enabled WxWork Bot accounts configured");
  }

  log(
    `wxwork-bot: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(", ")}`,
  );

  await Promise.all(
    accounts.map((account) =>
      monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
      }),
    ),
  );
}

/**
 * Stop monitoring for a specific account or all accounts.
 */
export function stopWxworkBotMonitor(accountId?: string): void {
  if (accountId) {
    const server = httpServers.get(accountId);
    if (server) {
      server.close();
      httpServers.delete(accountId);
    }
  } else {
    for (const server of httpServers.values()) {
      server.close();
    }
    httpServers.clear();
  }
}
