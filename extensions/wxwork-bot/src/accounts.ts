import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "openclaw/plugin-sdk/account-id";
import type {
  WxworkBotConfig,
  ResolvedWxworkBotAccount,
} from "./types.js";

/**
 * List all configured account IDs from the accounts field.
 */
function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = (cfg.channels?.["wxwork-bot"] as WxworkBotConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

/**
 * List all WxWork Bot account IDs.
 * Returns [DEFAULT_ACCOUNT_ID] for backward compatibility if no accounts configured.
 */
export function listWxworkBotAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return [...ids].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Resolve default account ID.
 */
export function resolveDefaultWxworkBotAccountId(cfg: ClawdbotConfig): string {
  const ids = listWxworkBotAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Merge top-level config with account-specific config.
 */
function mergeWxworkBotAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): WxworkBotConfig {
  const wxworkCfg = cfg.channels?.["wxwork-bot"] as WxworkBotConfig | undefined;
  const { accounts: _ignored, ...base } = wxworkCfg ?? {};
  const account = wxworkCfg?.accounts?.[accountId] ?? {};
  return { ...base, ...account } as WxworkBotConfig;
}

/**
 * Resolve a complete WxWork Bot account with merged config.
 */
export function resolveWxworkBotAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedWxworkBotAccount {
  const accountId = normalizeAccountId(params.accountId);
  const wxworkCfg = params.cfg.channels?.["wxwork-bot"] as
    | WxworkBotConfig
    | undefined;

  const baseEnabled = wxworkCfg?.enabled !== false;
  const merged = mergeWxworkBotAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const webhookKey = merged.webhookKey?.trim() || undefined;
  const token = merged.token?.trim() || undefined;
  const encodingAesKey = merged.encodingAesKey?.trim() || undefined;
  const configured = Boolean(webhookKey && token && encodingAesKey);

  return {
    accountId,
    enabled,
    configured,
    name: (merged as Record<string, unknown>).name as string | undefined,
    webhookKey,
    token,
    encodingAesKey,
    config: merged,
  };
}

/**
 * List all enabled and configured accounts.
 */
export function listEnabledWxworkBotAccounts(
  cfg: ClawdbotConfig,
): ResolvedWxworkBotAccount[] {
  return listWxworkBotAccountIds(cfg)
    .map((accountId) => resolveWxworkBotAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}
