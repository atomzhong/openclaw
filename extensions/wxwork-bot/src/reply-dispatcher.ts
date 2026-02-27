import {
  createReplyPrefixContext,
  type ClawdbotConfig,
  type ReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { sendWxworkBotMarkdown } from "./api.js";
import { getWxworkBotRuntime } from "./runtime.js";

export type CreateWxworkBotReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  webhookUrl: string;
  accountId?: string;
};

export function createWxworkBotReplyDispatcher(params: CreateWxworkBotReplyDispatcherParams) {
  const core = getWxworkBotRuntime();
  const { cfg, agentId, webhookUrl, accountId } = params;
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "wxwork-bot", accountId, {
    fallbackLimit: 4096,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "wxwork-bot");

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      deliver: async (payload: ReplyPayload) => {
        const text = payload.text ?? "";
        const log = params.runtime.log ?? console.log;
        log(
          `wxwork-bot[${accountId}]: [DEBUG] deliver called, payload.text length=${text.length}, preview="${text.slice(0, 200)}"`,
        );
        if (!text.trim()) return;

        for (const chunk of core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode)) {
          log(
            `wxwork-bot[${accountId}]: [DEBUG] sending chunk (${chunk.length} chars): "${chunk.slice(0, 200)}..."`,
          );
          await sendWxworkBotMarkdown({
            webhookUrl,
            content: chunk,
          });
        }
      },
      onError: async (error) => {
        params.runtime.error?.(`wxwork-bot[${accountId}] reply failed: ${String(error)}`);
      },
      onIdle: async () => {
        // no-op
      },
      onCleanup: () => {
        // no-op
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
