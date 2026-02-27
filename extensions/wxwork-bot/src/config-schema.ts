import { z } from "zod";
export { z };

const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);

export const WxworkBotAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    /** Webhook key (the key parameter from the webhook URL) */
    webhookKey: z.string().optional(),
    /** Token for msg_signature verification */
    token: z.string().optional(),
    /** EncodingAESKey for AES encryption/decryption (base64, 43 chars) */
    encodingAesKey: z.string().optional(),
    /** Webhook path for receiving callbacks */
    webhookPath: z.string().optional(),
  })
  .strict();

export const WxworkBotConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    // Top-level credentials (single-account mode)
    webhookKey: z.string().optional(),
    token: z.string().optional(),
    encodingAesKey: z.string().optional(),
    // Webhook server settings
    webhookHost: z.string().optional(),
    webhookPort: z.number().int().positive().optional(),
    webhookPath: z.string().optional().default("/wxwork-bot/callback"),
    // Callback protocol format: json or xml
    callbackFormat: z.enum(["json", "xml"]).optional().default("json"),
    // Policies
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.string()).optional(),
    requireMention: z.boolean().optional().default(true),
    // History
    historyLimit: z.number().int().min(0).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    // Chunking
    textChunkLimit: z.number().int().positive().optional(),
    // Multi-account
    accounts: z
      .record(z.string(), WxworkBotAccountConfigSchema.optional())
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.webhookKey?.trim() && !value.accounts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["webhookKey"],
        message:
          "channels.wxwork-bot.webhookKey is required (or configure accounts)",
      });
    }
    if (!value.token?.trim() && !value.accounts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["token"],
        message:
          "channels.wxwork-bot.token is required for callback verification",
      });
    }
    if (!value.encodingAesKey?.trim() && !value.accounts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["encodingAesKey"],
        message:
          "channels.wxwork-bot.encodingAesKey is required for message decryption",
      });
    }
    if (value.dmPolicy === "open") {
      const allowFrom = value.allowFrom ?? [];
      const hasWildcard = allowFrom.some(
        (entry) => String(entry).trim() === "*",
      );
      if (!hasWildcard) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message:
            'channels.wxwork-bot.dmPolicy="open" requires channels.wxwork-bot.allowFrom to include "*"',
        });
      }
    }
  });
