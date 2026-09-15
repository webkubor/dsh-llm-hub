<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/banner.png" alt="dsh-llm-hub" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-llm-hub"><img src="https://img.shields.io/npm/v/dsh-llm-hub?style=flat-square&color=4C7EF3&label=npm" alt="npm" /></a>
  <img src="https://img.shields.io/badge/deps-0-5A9E6F?style=flat-square" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=flat-square" alt="MIT" />
  &nbsp;·&nbsp; <a href="README.en.md">English</a> · <a href="CHANGELOG.md">更新日志</a>
</p>

DSH 的模型页上，官方适配器有一半事情没做。这个插件把它补上：

| | 官方适配器 | dsh-llm-hub |
|---|---|---|
| DeepSeek 有哪些模型 | 看不到 | **一键拉取在售列表** |
| 账户还剩多少钱 | 看不到 | **卡片下常驻余额** |
| 网关通不通、多快 | 按钮点了没反应 | **实测延迟与状态** |
| 网关上有多少模型 | 看不到 | **实测 71 个**（手填只有 11） |
| 为什么探测不了 | 无提示 | **写明「没配 baseURL」** |

## 装

```sh
cd ~/.dsh/profiles/web && npm i dsh-llm-hub
```

再把 `dsh-llm-hub` 加进同一个 `package.json` 的 `dsh.profile.bundles` 数组，然后 `~/.dsh/restart.sh`。
打开**设置 → 模型**，provider 卡片下方会多出一行。

<sub>boot graph 变了必须重启，热载不生效；`cordis.patch.yml` 由 bundle 机制自动 insert。</sub>

---

## 它补的是什么

DSH 自己已经具备全部机制，缺的只是"官方适配器没去用它们"：

| 能力 | 官方机制 | 官方直连的现状 |
|---|---|---|
| 模型发现 | `llm` 服务的 `registerModelDiscovery(ns, discover)` + Models 页「获取可用模型」 | `@deepseek-ai/dsh-llm-deepseek` **从未注册**（`0.1.2-rc.1` 与 `0.1.5-rc.2` 两版实测 `discover` 均零命中） |
| provider 卡片扩展 | `settings.models.provider-card`（按 `settingsNs` 做 key 分发） | 无注册者 → 该区域不渲染 |
| 账户余额 | DeepSeek `GET /user/balance` | 适配器不暴露 |

**发现注册表每个 settings 命名空间只允许一个注册**（第二次抛 `DUPLICATE_DISCOVERY`），
而 `llm-deepseek` 这个槽是空的 —— 本插件占上即可。官方 `slot-contract.d.ts` 也明确：
那两个扩展位就是给**本仓库之外分发的插件**用的。

## 安装

```sh
# 1) 装进你的 profile（profile 名按自己的改，默认 web）
dsh plugin --profile web add dsh-llm-hub
#    本地开发改用：npm run deploy（软链进 web profile 的 node_modules）

# 2) 接进 boot graph（一次性）：把 "dsh-llm-hub" 加进
#    ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 数组。
#    本包的 cordis.patch.yml 随 bundle 机制自动 insert，无需手写行。

# 3) 重启（改的是 boot graph，必须重启）
~/.dsh/restart.sh
```

## 用法

**模型发现**：设置 → 模型 → **DeepSeek（官方直连）** → **「获取可用模型」**。
点下去会实时 `GET https://api.deepseek.com/models`，列出官方在售模型供勾选加入。

**余额**：同一张 DeepSeek 卡片下方会出现余额行（挂载即查，可手动刷新）。

**pi-ai 旁路卡**：设置 → 模型 → 任一 pi-ai provider（modelgo / minimax / zai-coding-cn …）卡片下方：

- 常驻行：`pi-ai · 显示名 · 已配 N 个模型 · Key ✓/✗`
- **探测网关**：实时 GET 网关目录端点（`/v1/models` 与 `/models` 按 baseURL 形态自动回退），报告可达性、延迟与在售数量
- **modelgo 专属**：**拉取目录**列出网关在售模型（实测 71 个，手填仅 11 个），**复制全部 id** 后可直接粘贴整理
- zai-coding-cn 这类没写 baseURL 的 provider 显示"无法探测"提示，模型仍走手填

![pi-ai 行：三个 provider 的可达性探测与目录拉取](https://img.webkubor.online/oss/dsh-llm-hub/models-piai-cards.png)

![DeepSeek 卡片上的余额行](https://img.webkubor.online/oss/dsh-llm-hub/models-deepseek-balance.png)

## 行为细节

### 连接事实

baseURL 与 apiKey 的解析顺序与适配器自身一致，且**每次调用惰性重读** `llm-deepseek`
设置段 —— 插件 apply 时该段可能尚未注册（启动竞态），而适配器本身也按请求重解析：

| | 解析顺序 |
|---|---|
| baseURL | `request.baseURL` → 设置段 `baseURL` → `$DEEPSEEK_BASE_URL` → `https://api.deepseek.com` |
| apiKey | `request.apiKey`（表单里现填的一次性 key）→ 设置段 `apiKeyEnv` 指定的凭据 → 该环境变量 |

### 余额路由

`GET /api/dsh-llm-hub/balance` → `{ ok, isAvailable, balances: [{ currency, total, granted, toppedUp }] }`

金额**原样保留 DeepSeek 返回的字符串**（上游是字符串，避免浮点误差）。
只接受 `GET`/`HEAD`（否则 405），并拒绝跨站读取（`Sec-Fetch-Site` 非 same-origin/none 时 403）
—— 余额属账户信息，即使服务绑在 loopback 也不该被跨站页面读走。

### pi-ai 旁路路由

官方 `@deepseek-ai/dsh-llm-pi-ai` **自己占用了** `llm-pi-ai` 的 discovery 坑（抢注会
`DUPLICATE_DISCOVERY`），且其 `LISTABLE_PROTOCOLS = {openai-completions, openai-responses}`：

| provider | api | baseURL | 官方发现 | 本插件 |
|---|---|---|---|---|
| minimax | openai-completions | ✓ | **已可用**（无需本插件） | 探测卡 |
| modelgo | anthropic-messages | ✓ | 天然失效（协议不可列） | 探测卡 + 目录拉取/复制 |
| zai-coding-cn | — | ✗ | 不可用（无端点） | 提示手填 |

三条只读路由，全部 `GET`/`HEAD` 限定 + 同源校验（与余额路由同一套纪律），
provider profile 每次调用惰性重读 `llm-pi-ai` 段：

- `GET /api/dsh-llm-hub/pi-ai/status?provider=<id>` → `{ ok, displayName, api, baseURL, apiKeyEnv, keyConfigured, modelCount }`
- `GET /api/dsh-llm-hub/pi-ai/probe?provider=<id>` → `{ ok, reachable, latencyMs, remoteCount?, sample?, code?, error? }`
- `GET /api/dsh-llm-hub/pi-ai/catalog?provider=<id>` → `{ ok, latencyMs, models: [{ id, name?, contextWindow?, maxTokens? }] }`

密钥解析与官方一致：凭据服务（`apiKeyEnv` 引用）→ 进程环境变量。

### 前端挂载点

`settings.models.provider-card`，`key = 'llm-deepseek'`。owner props 的
`keyConfigured` 决定是否发起查询：未配置密钥时显示提示而不请求。

## 已知限制

**发现候选承载不了 `inputModalities`。** llm 服务只保留
`id`/`name`/`contextWindow`/`maxTokens` 四个字段。所以通过按钮加入的 `deepseek-flash`
会落成**纯文本**条目，而它实际支持图像输入。加入后请手动补：

```yaml
llm-deepseek:
  models:
    - id: deepseek-flash
      inputModalities: [ text, image ]
```

这是 harness 发现契约本身的限制（官方 pi-ai 那条路同样如此），插件层无法修正。

## 升级到 0.2.0 后的验证

host 半不能热载，`npm run deploy` 之后需要 `~/.dsh/restart.sh`，然后：

1. `curl -s 'http://127.0.0.1:3080/api/dsh-llm-hub/pi-ai/status?provider=modelgo'` → `modelCount` 应等于 settings 里手填的模型数
2. `curl -s 'http://127.0.0.1:3080/api/dsh-llm-hub/pi-ai/probe?provider=modelgo'` → `reachable: true`、`remoteCount` 在 71 量级（目录随网关增长）
3. `curl -s 'http://127.0.0.1:3080/api/dsh-llm-hub/pi-ai/probe?provider=zai-coding-cn'` → `reachable: false` + "没有配置 baseURL"（符合预期）
4. 页面：设置 → 模型 → modelgo 卡片下方出现 pi-ai 行，探测 / 拉取 / 复制可用；DeepSeek 余额卡行为不变

## 开发

```sh
npm run check     # 两半语法
npm run deploy    # 同步到 web profile
```

- **host 半** `lib/index.js`：ESM（cordis loader 按 ESM 读）。
- **client 半** `lib/client.js`：**源码即产物**，classic script（无顶层 import/export），
  经 `window.__ModuleLoader__.load({ id, factory })` 注册。`id` **必须与 package.json 的
  `name` 完全一致**，否则 DSH 拒绝注册。React 由 `factory(require)` 提供，不打包进产物。
  当前体量无需构建步骤；若将来拆多文件，再加 esbuild（`format: 'iife'`，React 等标 external）。

## License

MIT
