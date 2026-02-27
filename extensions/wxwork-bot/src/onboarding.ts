import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  ClawdbotConfig,
  DmPolicy,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
} from "openclaw/plugin-sdk";
import type { WxworkBotConfig } from "./types.js";

const channel = "wxwork-bot" as const;

function setWxworkBotDmPolicy(
  cfg: ClawdbotConfig,
  dmPolicy: DmPolicy,
): ClawdbotConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(
          cfg.channels?.["wxwork-bot"]?.allowFrom,
        )?.map((entry) => String(entry))
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "wxwork-bot": {
        ...cfg.channels?.["wxwork-bot"],
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setWxworkBotAllowFrom(
  cfg: ClawdbotConfig,
  allowFrom: string[],
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "wxwork-bot": {
        ...cfg.channels?.["wxwork-bot"],
        allowFrom,
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptWxworkBotAllowFrom(params: {
  cfg: ClawdbotConfig;
  prompter: WizardPrompter;
}): Promise<ClawdbotConfig> {
  const existing = params.cfg.channels?.["wxwork-bot"]?.allowFrom ?? [];
  await params.prompter.note(
    [
      "设置允许与机器人单聊的用户 ID (userId)。",
      "可以在企业微信管理后台查看用户 ID。",
      "示例：",
      "- zhangsan",
      "- lisi",
    ].join("\n"),
    "WxWork Bot 允许列表",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "WxWork Bot allowFrom (用户 userId)",
      placeholder: "zhangsan, lisi",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) =>
        String(value ?? "").trim() ? undefined : "必填",
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note(
        "请至少输入一个用户 ID。",
        "WxWork Bot 允许列表",
      );
      continue;
    }

    const unique = [
      ...new Set([
        ...existing
          .map((v: string | number) => String(v).trim())
          .filter(Boolean),
        ...parts,
      ]),
    ];
    return setWxworkBotAllowFrom(params.cfg, unique);
  }
}

async function noteWxworkBotCredentialHelp(
  prompter: WizardPrompter,
): Promise<void> {
  await prompter.note(
    [
      "1) 在企业微信群中添加群机器人",
      "2) 获取 Webhook URL（其中包含 key 参数）",
      "3) 在消息推送配置页面设置回调 URL、Token、EncodingAESKey",
      "4) Token: 3~32 位英文或数字，用于生成签名",
      "5) EncodingAESKey: 43 位英文或数字，用于消息加解密",
      `文档: ${formatDocsLink("/channels/wxwork-bot", "wxwork-bot")}`,
    ].join("\n"),
    "WxWork Bot 凭据",
  );
}

async function promptWxworkBotCredentials(prompter: WizardPrompter): Promise<{
  webhookKey: string;
  token: string;
  encodingAesKey: string;
}> {
  const webhookKeyOrUrl = String(
    await prompter.text({
      message: "输入 Webhook URL 或 Key",
      placeholder:
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx 或直接输入 key",
      validate: (value) => (value?.trim() ? undefined : "必填"),
    }),
  ).trim();

  // Extract key from full URL if needed
  let webhookKey = webhookKeyOrUrl;
  try {
    const url = new URL(webhookKeyOrUrl);
    const key = url.searchParams.get("key");
    if (key) webhookKey = key;
  } catch {
    // Not a URL, treat as key directly
  }

  const token = String(
    await prompter.text({
      message: "输入 Token（用于签名验证）",
      validate: (value) => (value?.trim() ? undefined : "必填"),
    }),
  ).trim();

  const encodingAesKey = String(
    await prompter.text({
      message: "输入 EncodingAESKey（43 位，用于消息加解密）",
      validate: (value) => {
        const v = value?.trim() ?? "";
        if (!v) return "必填";
        if (v.length !== 43) return "EncodingAESKey 必须为 43 位";
        return undefined;
      },
    }),
  ).trim();

  return { webhookKey, token, encodingAesKey };
}

function setWxworkBotGroupPolicy(
  cfg: ClawdbotConfig,
  groupPolicy: "open" | "allowlist" | "disabled",
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "wxwork-bot": {
        ...cfg.channels?.["wxwork-bot"],
        enabled: true,
        groupPolicy,
      },
    },
  };
}

function setWxworkBotGroupAllowFrom(
  cfg: ClawdbotConfig,
  groupAllowFrom: string[],
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "wxwork-bot": {
        ...cfg.channels?.["wxwork-bot"],
        groupAllowFrom,
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "WxWork Bot",
  channel,
  policyKey: "channels.wxwork-bot.dmPolicy",
  allowFromKey: "channels.wxwork-bot.allowFrom",
  getCurrent: (cfg) =>
    (cfg.channels?.["wxwork-bot"] as WxworkBotConfig | undefined)?.dmPolicy ??
    "pairing",
  setPolicy: (cfg, policy) => setWxworkBotDmPolicy(cfg, policy),
  promptAllowFrom: promptWxworkBotAllowFrom,
};

export const wxworkBotOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const wxworkCfg = cfg.channels?.["wxwork-bot"] as
      | WxworkBotConfig
      | undefined;
    const configured = Boolean(
      wxworkCfg?.webhookKey?.trim() &&
        wxworkCfg?.token?.trim() &&
        wxworkCfg?.encodingAesKey?.trim(),
    );

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("WxWork Bot: 需要配置 Webhook 凭据");
    } else {
      statusLines.push("WxWork Bot: 已配置");
    }

    return {
      channel,
      configured,
      statusLines,
      selectionHint: configured ? "已配置" : "需要 Webhook 凭据",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const wxworkCfg = cfg.channels?.["wxwork-bot"] as
      | WxworkBotConfig
      | undefined;
    const hasConfigCreds = Boolean(
      wxworkCfg?.webhookKey?.trim() &&
        wxworkCfg?.token?.trim() &&
        wxworkCfg?.encodingAesKey?.trim(),
    );

    let next = cfg;

    if (!hasConfigCreds) {
      await noteWxworkBotCredentialHelp(prompter);
    }

    if (hasConfigCreds) {
      const keep = await prompter.confirm({
        message: "WxWork Bot 凭据已配置，是否保留？",
        initialValue: true,
      });
      if (!keep) {
        const entered = await promptWxworkBotCredentials(prompter);
        next = {
          ...next,
          channels: {
            ...next.channels,
            "wxwork-bot": {
              ...next.channels?.["wxwork-bot"],
              enabled: true,
              webhookKey: entered.webhookKey,
              token: entered.token,
              encodingAesKey: entered.encodingAesKey,
            },
          },
        };
      }
    } else {
      const entered = await promptWxworkBotCredentials(prompter);
      next = {
        ...next,
        channels: {
          ...next.channels,
          "wxwork-bot": {
            ...next.channels?.["wxwork-bot"],
            enabled: true,
            webhookKey: entered.webhookKey,
            token: entered.token,
            encodingAesKey: entered.encodingAesKey,
          },
        },
      };
    }

    // Callback format selection
    const callbackFormat = await prompter.select({
      message: "回调消息格式",
      options: [
        { value: "json", label: "JSON（推荐）" },
        { value: "xml", label: "XML" },
      ],
      initialValue:
        (next.channels?.["wxwork-bot"] as WxworkBotConfig | undefined)
          ?.callbackFormat ?? "json",
    });
    if (callbackFormat) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          "wxwork-bot": {
            ...next.channels?.["wxwork-bot"],
            callbackFormat: callbackFormat as "json" | "xml",
          },
        },
      };
    }

    // Group policy
    const groupPolicy = await prompter.select({
      message: "群聊策略",
      options: [
        {
          value: "allowlist",
          label: "允许列表 - 仅在指定群聊中响应",
        },
        {
          value: "open",
          label: "开放 - 在所有群聊中响应（需要 @机器人）",
        },
        { value: "disabled", label: "禁用 - 不在群聊中响应" },
      ],
      initialValue:
        (next.channels?.["wxwork-bot"] as WxworkBotConfig | undefined)
          ?.groupPolicy ?? "allowlist",
    });
    if (groupPolicy) {
      next = setWxworkBotGroupPolicy(
        next,
        groupPolicy as "open" | "allowlist" | "disabled",
      );
    }

    // Group allowlist
    if (groupPolicy === "allowlist") {
      const existing =
        (next.channels?.["wxwork-bot"] as WxworkBotConfig | undefined)
          ?.groupAllowFrom ?? [];
      const entry = await prompter.text({
        message: "群聊允许列表（chatId）",
        placeholder: "wrkXXXXX, wrkYYYYY",
        initialValue:
          existing.length > 0 ? existing.map(String).join(", ") : undefined,
      });
      if (entry) {
        const parts = parseAllowFromInput(String(entry));
        if (parts.length > 0) {
          next = setWxworkBotGroupAllowFrom(next, parts);
        }
      }
    }

    // Webhook server port
    const port = await prompter.text({
      message: "Webhook 监听端口",
      placeholder: "3000",
      initialValue: String(
        (next.channels?.["wxwork-bot"] as WxworkBotConfig | undefined)
          ?.webhookPort ?? 3000,
      ),
    });
    if (port) {
      const portNum = parseInt(String(port), 10);
      if (!isNaN(portNum) && portNum > 0) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            "wxwork-bot": {
              ...next.channels?.["wxwork-bot"],
              webhookPort: portNum,
            },
          },
        };
      }
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      "wxwork-bot": { ...cfg.channels?.["wxwork-bot"], enabled: false },
    },
  }),
};
