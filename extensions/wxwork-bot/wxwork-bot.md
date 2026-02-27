# WxWork Bot（企业微信群机器人）配置文档

## 概述

WxWork Bot 是 OpenClaw 的企业微信群机器人接入插件，通过 Webhook 回调方式接收企业微信群聊/单聊消息，并调用 AI Agent 生成回复。

支持的消息类型：文本、图片、混合消息（图文）。
回复格式：Markdown（支持企业微信 Markdown 子集）。

---

## 快速开始

### 1. 企业微信端配置

1. 在企业微信群中**添加群机器人**
2. 获取 **Webhook URL**（格式：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<webhookKey>`）
3. 在机器人的**消息推送配置**页面设置：
   - **回调 URL**：`http://<你的服务器IP>:<默认监听端口>3000/wxwork-bot/callback`
   - **Token**：自定义 3~32 位英文或数字字符串
   - **EncodingAESKey**：自定义 43 位英文或数字字符串

### 2. OpenClaw 配置

在 `~/.openclaw/config.yaml` 中添加：

```yaml
channels:
  wxwork-bot:
    enabled: true
    webhookKey: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    token: "your-token"
    encodingAesKey: "your-encoding-aes-key-43-chars-long-xxxxxxxx"
```

### 3. 启动

```bash
openclaw gateway run
```

---

## 完整配置参考

```yaml
channels:
  wxwork-bot:
    # ========== 基础配置 ==========
    enabled: true                          # 是否启用（默认 true）

    # ========== 凭据（必填，单账号模式） ==========
    webhookKey: ""                         # Webhook URL 中的 key 参数（必填）
    token: ""                              # 消息签名验证 Token（必填，3~32 位）
    encodingAesKey: ""                     # 消息加解密密钥（必填，43 位）

    # ========== Webhook 服务器 ==========
    webhookHost: "127.0.0.1"              # 监听地址（默认 127.0.0.1）
    webhookPort: 3000                      # 监听端口（默认 3000）
    webhookPath: "/wxwork-bot/callback"    # 回调路径（默认 /wxwork-bot/callback）
    callbackFormat: "json"                 # 回调消息格式：json | xml（默认 json）

    # ========== 单聊策略 ==========
    dmPolicy: "pairing"                    # 单聊准入策略（默认 pairing）
    allowFrom:                             # 单聊允许列表（用户 userId）
      - "zhangsan"
      - "lisi"

    # ========== 群聊策略 ==========
    groupPolicy: "allowlist"               # 群聊准入策略（默认 allowlist）
    groupAllowFrom:                        # 群聊允许列表（群 chatId）
      - "wrkSWJ3xxxx"
    requireMention: true                   # 群聊中是否需要 @机器人才响应（默认 true）

    # ========== 历史记录 ==========
    historyLimit: 10                       # 群聊历史消息轮数（默认 10）
    dmHistoryLimit: 10                     # 单聊历史消息轮数（默认 10）

    # ========== 消息分片 ==========
    textChunkLimit: 4096                   # 单条回复最大字符数，超出自动分片（默认 4096）

    # ========== 多账号模式（可选） ==========
    accounts:
      bot1:
        enabled: true
        name: "客服机器人"
        webhookKey: "key-1"
        token: "token-1"
        encodingAesKey: "aes-key-1"
        webhookPath: "/wxwork-bot/callback/bot1"
      bot2:
        enabled: true
        name: "技术支持机器人"
        webhookKey: "key-2"
        token: "token-2"
        encodingAesKey: "aes-key-2"
        webhookPath: "/wxwork-bot/callback/bot2"
```

---

## 配置项详解

### 凭据

| 配置项 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `webhookKey` | string | 是* | Webhook URL 中的 `key` 参数，用于发送回复消息 |
| `token` | string | 是* | 3~32 位字符串，用于回调签名验证（SHA1） |
| `encodingAesKey` | string | 是* | 43 位字符串，用于消息 AES-256-CBC 加解密 |

> \* 单账号模式下必填；多账号模式下在各 `accounts.<id>` 中配置。

### Webhook 服务器

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `webhookHost` | string | `127.0.0.1` | HTTP 服务器监听地址 |
| `webhookPort` | integer | `3000` | HTTP 服务器监听端口 |
| `webhookPath` | string | `/wxwork-bot/callback` | 回调接收路径 |
| `callbackFormat` | `json` \| `xml` | `json` | 企业微信推送的消息格式 |

### 单聊策略（dmPolicy）

| 值 | 说明 |
|---|---|
| `pairing`（默认） | **配对模式**：陌生用户发消息后收到配对码，管理员执行 `openclaw pairing approve wxwork-bot <code>` 审批后才可使用。最安全。 |
| `allowlist` | **白名单模式**：仅 `allowFrom` 列表中的用户 userId 可以单聊机器人。 |
| `open` | **开放模式**：任何人都可以单聊。必须同时设置 `allowFrom: ["*"]` 作为安全确认。 |

**安全级别**：`pairing` > `allowlist` > `open`

**配对模式工作流程**：
1. 用户发消息 → 机器人回复配对码（如 `A3BK7NHR`）
2. 管理员在终端执行：`openclaw pairing approve wxwork-bot A3BK7NHR`
3. 用户自动加入允许列表，后续消息正常处理

**管理命令**：
```bash
openclaw pairing list wxwork-bot          # 查看待审批请求
openclaw pairing approve wxwork-bot <code> # 审批
openclaw pairing approve wxwork-bot <code> --notify  # 审批并通知用户
```

### 群聊策略（groupPolicy）

| 值 | 说明 |
|---|---|
| `allowlist`（默认） | 仅在 `groupAllowFrom` 列表中的群聊里响应 |
| `open` | 在所有群聊中响应（仍受 `requireMention` 控制） |
| `disabled` | 不在任何群聊中响应 |

### groupAllowFrom 获取方式

`groupAllowFrom` 需要填入群的 `chatId`，该值来自企业微信回调数据，无法在管理后台直接查看。获取方法：

1. 临时将 `groupPolicy` 设为 `open`
2. 在目标群中 @机器人发送一条消息
3. 查看网关日志，找到类似输出：
   ```
   wxwork-bot[default]: text from 张三 (zhangsan) in group:wrkSWJ3xxxx
   ```
4. `wrkSWJ3xxxx` 即为 chatId，填入 `groupAllowFrom`
5. 将 `groupPolicy` 改回 `allowlist`

填写 `"*"` 可允许所有群聊。

### 历史记录与消息分片

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `historyLimit` | integer | 10 | 群聊中保留的历史消息轮数，用于上下文 |
| `dmHistoryLimit` | integer | 10 | 单聊中保留的历史消息轮数 |
| `textChunkLimit` | integer | 4096 | 单条消息最大字符数，超出时自动分片发送 |

---

## 多账号模式

当需要接入多个群机器人时，使用 `accounts` 配置。每个账号独立监听各自的 webhookPath：

```yaml
channels:
  wxwork-bot:
    enabled: true
    webhookPort: 3000          # 共享同一端口
    groupPolicy: allowlist     # 策略配置在顶层，所有账号共享
    accounts:
      sales-bot:
        webhookKey: "key-sales"
        token: "token-sales"
        encodingAesKey: "aes-key-sales"
        webhookPath: "/wxwork-bot/callback/sales"
      support-bot:
        webhookKey: "key-support"
        token: "token-support"
        encodingAesKey: "aes-key-support"
        webhookPath: "/wxwork-bot/callback/support"
```

各账号的 `webhookKey`、`token`、`encodingAesKey` 必须单独配置。策略类配置（`dmPolicy`、`groupPolicy` 等）在顶层设置，所有账号共享。

---

## 安全机制

- **签名验证**：每个回调请求通过 SHA1 签名（`msg_signature`）验证来源合法性
- **AES 加解密**：消息内容使用 AES-256-CBC 加密传输，密钥由 EncodingAESKey 派生
- **频率限制**：单个来源 IP 每分钟最多 120 次请求
- **请求体限制**：最大 1MB，超时 30 秒
- **消息去重**：基于 msgId 去重，5 分钟内相同消息不会重复处理

---

## 支持的消息类型

| 接收类型 | 说明 |
|---|---|
| `text` | 文本消息 |
| `image` | 图片消息（提取图片 URL） |
| `mixed` | 混合消息（图文组合） |
| `event` | 事件通知（加入群聊/退出群聊等，仅记录日志） |
| `attachment` | 按钮回调（仅记录日志） |
| `command` | 命令消息（仅记录日志） |

回复类型：**Markdown**（自动分片）。
