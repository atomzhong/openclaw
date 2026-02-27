/**
 * WxWork Bot API client — send messages via the webhook URL.
 *
 * WxWork Bot uses the webhook URL from the callback message to send responses.
 * Supported message types: text, markdown.
 */

export type WxworkBotSendTextParams = {
  webhookUrl: string;
  content: string;
  mentionedList?: string[];
  mentionedMobileList?: string[];
  visibleToUser?: string;
};

export type WxworkBotSendMarkdownParams = {
  webhookUrl: string;
  content: string;
  visibleToUser?: string;
};

/**
 * Send a text message via the webhook URL.
 */
export async function sendWxworkBotText(
  params: WxworkBotSendTextParams,
): Promise<void> {
  const { webhookUrl, content, mentionedList, mentionedMobileList } = params;

  const body: Record<string, unknown> = {
    msgtype: "text",
    text: {
      content,
      ...(mentionedList?.length ? { mentioned_list: mentionedList } : {}),
      ...(mentionedMobileList?.length
        ? { mentioned_mobile_list: mentionedMobileList }
        : {}),
    },
  };

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(
      `WxWork Bot send text failed: ${resp.status} ${resp.statusText}`,
    );
  }
}

/**
 * Send a markdown message via the webhook URL.
 */
export async function sendWxworkBotMarkdown(
  params: WxworkBotSendMarkdownParams,
): Promise<void> {
  const { webhookUrl, content } = params;

  const body: Record<string, unknown> = {
    msgtype: "markdown",
    markdown: { content },
  };

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(
      `WxWork Bot send markdown failed: ${resp.status} ${resp.statusText}`,
    );
  }
}

/**
 * Get chat info using the temporary URL provided in callback.
 */
export async function getWxworkBotChatInfo(
  getChatInfoUrl: string,
): Promise<{
  chatid: string;
  name?: string;
  chattype: string;
  members?: Array<{
    userid: string;
    alias: string;
    name: string;
  }>;
} | null> {
  try {
    const resp = await fetch(getChatInfoUrl);
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    if ((data.errcode as number) !== 0) return null;
    return data as {
      chatid: string;
      name?: string;
      chattype: string;
      members?: Array<{ userid: string; alias: string; name: string }>;
    };
  } catch {
    return null;
  }
}
