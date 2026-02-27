import type {
  ChannelMeta,
  ChannelPlugin,
  ClawdbotConfig,
} from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "openclaw/plugin-sdk";
import {
  resolveWxworkBotAccount,
  listWxworkBotAccountIds,
  resolveDefaultWxworkBotAccountId,
} from "./accounts.js";
import { wxworkBotOnboardingAdapter } from "./onboarding.js";
import { wxworkBotOutbound } from "./outbound.js";
import { sendMessageWxworkBot } from "./send.js";
import type { ResolvedWxworkBotAccount, WxworkBotConfig } from "./types.js";

const meta: ChannelMeta = {
  id: "wxwork-bot",
  label: "WxWork Bot",
  selectionLabel: "WxWork Bot (企业微信机器人)",
  docsPath: "/channels/wxwork-bot",
  docsLabel: "wxwork-bot",
  blurb: "企业微信群机器人 Webhook 消息推送。",
  order: 95,
};

export const wxworkBotPlugin: ChannelPlugin<ResolvedWxworkBotAccount> = {
  id: "wxwork-bot",
  meta: { ...meta },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: false,
    media: false,
    reactions: false,
    edit: false,
    reply: false,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- WxWork Bot targeting: omit `target` to reply to the current conversation (auto-inferred via webhook URL).",
      "- WxWork Bot supports text and markdown message types.",
    ],
  },
  reload: { configPrefixes: ["channels.wxwork-bot"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        webhookKey: { type: "string" },
        token: { type: "string" },
        encodingAesKey: { type: "string" },
        webhookHost: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        webhookPath: { type: "string" },
        callbackFormat: { type: "string", enum: ["json", "xml"] },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        groupPolicy: {
          type: "string",
          enum: ["open", "allowlist", "disabled"],
        },
        groupAllowFrom: { type: "array", items: { type: "string" } },
        requireMention: { type: "boolean" },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              webhookKey: { type: "string" },
              token: { type: "string" },
              encodingAesKey: { type: "string" },
              webhookPath: { type: "string" },
            },
          },
        },
      },
    },
  },
  config: {
    listAccountIds: (cfg) => listWxworkBotAccountIds(cfg),
    resolveAccount: (cfg, accountId) =>
      resolveWxworkBotAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWxworkBotAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "wxwork-bot": {
              ...cfg.channels?.["wxwork-bot"],
              enabled,
            },
          },
        };
      }
      const wxworkCfg = cfg.channels?.["wxwork-bot"] as
        | WxworkBotConfig
        | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "wxwork-bot": {
            ...wxworkCfg,
            accounts: {
              ...wxworkCfg?.accounts,
              [accountId]: {
                ...wxworkCfg?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>)["wxwork-bot"];
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }
      const wxworkCfg = cfg.channels?.["wxwork-bot"] as
        | WxworkBotConfig
        | undefined;
      const accounts = { ...wxworkCfg?.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "wxwork-bot": {
            ...wxworkCfg,
            accounts:
              Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      webhookKey: account.webhookKey
        ? `${account.webhookKey.slice(0, 8)}...`
        : undefined,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveWxworkBotAccount({ cfg, accountId });
      return (account.config?.allowFrom ?? []).map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      const account = resolveWxworkBotAccount({ cfg, accountId });
      const wxworkCfg = account.config;
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.["wxwork-bot"] !== undefined,
        groupPolicy: wxworkCfg?.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy !== "open") return [];
      return [
        `- WxWork Bot[${account.accountId}] groups: groupPolicy="open" allows any group member to trigger. Set channels.wxwork-bot.groupPolicy="allowlist" + channels.wxwork-bot.groupAllowFrom to restrict.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "wxwork-bot": {
              ...cfg.channels?.["wxwork-bot"],
              enabled: true,
            },
          },
        };
      }
      const wxworkCfg = cfg.channels?.["wxwork-bot"] as
        | WxworkBotConfig
        | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "wxwork-bot": {
            ...wxworkCfg,
            accounts: {
              ...wxworkCfg?.accounts,
              [accountId]: {
                ...wxworkCfg?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },
  onboarding: wxworkBotOnboardingAdapter,
  messaging: {
    normalizeTarget: (raw) => raw || undefined,
    targetResolver: {
      looksLikeId: (raw) => raw.startsWith("http"),
      hint: "<webhookUrl>",
    },
  },
  outbound: wxworkBotOutbound,
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, {
      port: null,
    }),
    buildChannelSummary: ({ snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      port: snapshot.port ?? null,
    }),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { monitorWxworkBotProvider } = await import("./monitor.js");
      const account = resolveWxworkBotAccount({
        cfg: ctx.cfg,
        accountId: ctx.accountId,
      });
      const port = account.config?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(
        `starting wxwork-bot[${ctx.accountId}] (webhook mode)`,
      );
      return monitorWxworkBotProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};
