<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/banner.png" alt="dsh-llm-hub" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-llm-hub"><img src="https://img.shields.io/npm/v/%40dsh-plugins%2Fdsh-llm-hub?style=flat-square&color=4C7EF3&logo=npm&label=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-llm-hub"><img src="https://img.shields.io/npm/dm/%40dsh-plugins%2Fdsh-llm-hub?style=flat-square&color=6d7f9c&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2-4d6bfe?style=flat-square" alt="DSH" />
  <img src="https://img.shields.io/badge/runtime_deps-0-5A9E6F?style=flat-square" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-Plugin-4d6bfe?style=flat-square" alt="DSH Plugin" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-4d6bfe?style=flat-square" alt="dsh-plugin" /></a>
  <a href="https://github.com/topics/llm-gateway"><img src="https://img.shields.io/badge/topic-llm--gateway-4C7EF3?style=flat-square" alt="llm-gateway" /></a>
  &nbsp;·&nbsp; <a href="README.en.md">English</a> · <a href="CHANGELOG.md">更新日志</a>
</p>

DSH 的模型页上，官方适配器有一半事情没做。这个插件把它补上：

| | 官方适配器 | dsh-llm-hub |
|---|---|---|
| DeepSeek 有哪些模型 | 看不到 | **一键拉取在售列表** |
| 账户还剩多少钱 | 看不到 | **卡片下常驻余额 + 阈值预警** |
| 网关通不通、多快 | 按钮点了没反应 | **实测延迟与状态 + 健康看板** |
| 网关上有多少模型 | 看不到 | **实测 71 个**（手填只有 11） |
| 为什么探测不了 | 无提示 | **写明「没配 baseURL」** |
| 本月花了多少 token | 没有 | **用量统计 + 前 5 个最常用模型 + CSV 导出** |
| 不可用的 provider | 仍在下拉里 | **下拉里静默摘掉，卡片上标红 + 原因** |
| 外部 agent CLI（codex/claude/agy） | 装不装无感 | **装了就出现子代理工具** |

<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/v060/models-piai-cards.png" alt="装上之后的模型页：每张 provider 卡片下方多出一行 —— 协议、接入地址、已配模型数、余额，右侧是探测与拉取目录" width="100%" />
  <br />
  <sub>装上之后的模型页：每张 provider 卡片下方多出一行 —— 协议、接入地址、已配模型数、余额，右侧是探测与拉取目录</sub>
</p>

## 装

```sh
dsh plugin --profile web add @dsh-plugins/dsh-llm-hub
```

再把 `@dsh-plugins/dsh-llm-hub` 加进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组，
然后 `~/.dsh/restart.sh`。打开**设置 → 模型**，provider 卡片下方会多出一行。

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

## 用法

**模型发现**：设置 → 模型 → **DeepSeek（官方直连）** → **「获取可用模型」**。
点下去会实时 `GET https://api.deepseek.com/models`，列出官方在售模型供勾选加入。

**余额**：同一张 DeepSeek 卡片下方会出现余额行（挂载即查，可手动刷新）。

**pi-ai 旁路卡**：设置 → 模型 → 任一 pi-ai provider（modelgo / minimax / zai-coding-cn …）卡片下方：

- 常驻行：`pi-ai · 显示名 · 已配 N 个模型 · Key ✓/✗`
- **探测网关**：实时 GET 网关目录端点（`/v1/models` 与 `/models` 按 baseURL 形态自动回退），报告可达性、延迟与在售数量
- **modelgo 专属**：**拉取目录**列出网关在售模型（实测 71 个，手填仅 11 个），**复制全部 id** 后可直接粘贴整理
- zai-coding-cn 这类没写 baseURL 的 provider 显示"无法探测"提示，模型仍走手填

![DeepSeek 卡片上的余额行](https://img.webkubor.online/oss/dsh-llm-hub/v051/models-deepseek-balance.png)

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

## 模型下拉可用性（只留能用的）

composer 的模型下拉默认列出**所有已配置 provider**，与它们能不能调通无关 ——
key 过期、余额耗尽、网关 401，都会照常出现在那里，点了才报错。本插件把「确凿不可用」
的 provider 从下拉里摘掉：

**判定只认确凿证据**（fail-open，拿不准一律保留 —— 误藏一个能用的，比多显示一个不能用的更糟）：

| 信号 | 触发隐藏的例子 |
|---|---|
| 凭据 | `apiKeyEnv` 指向的变量解析不到（本机 / 凭据库里都没有） |
| 探测 | 网关对目录端点回 `401`/`403`/`402` |
| 余额 | DeepSeek `/user/balance` 报 `is_available=false` 或余额为 0；MiniMax/智谱的配额确凿用尽 |
| 运行期 | 真实请求因 `INVALID_CREDENTIAL` / `QUOTA_EXCEEDED` 失败（监听 `agent/request-error`） |

**恢复**是自动的：改好 key / 充值之后，`settings/document-updated` 会让缓存立刻作废，
下一次读取即重探；真实请求成功也会立即撤销运行期标记。设置页右下角的
**「重新探测全部」**用于立即强制重来一遍。

**被隐藏的 provider 不会消失**：设置 → 模型 的卡片照常在，只是那张卡的动作条上会多一枚
红色状态片「已从下拉隐藏」（原因在悬停提示里）；页脚则给出全局的「已隐藏 N」和
**「重新探测全部」**。不再另设一块逐条重述的面板 —— 卡片上本来就有状态，
再来一份只是重复（2026-09-16 owner：「这不是很多余吗，上面不都是显示了吗」）。

![ModelGo 卡上的「已从下拉隐藏」状态片，以及页脚的「已隐藏 1 · 重新探测全部」](https://img.webkubor.online/oss/dsh-llm-hub/v060/availability.png)

### 实现方式与取舍

过滤落在 **host 半的 `ctx.llm.listProviders()`** 上：这是唯一能一次覆盖所有消费方的缝
（composer 下拉、`/model` 弹窗、子代理选择器、ACP 都读它），而且**只做减法、可随插件卸载还原**。
设置页读的是 configurable-provider 目录（`listConfigurableProviders`），所以不受影响。

也试过在 client 半包 `ctx.modelDirectories`，**不行**：那是 cordis 的 inject 追踪代理，
读出来的方法被包成 traceable proxy，插件 fiber 缺 `remote.session` 注入，
一调用就 `cannot get property "remote.session" without inject` ——
2026-09-16 实测会把官方模型座位整个打崩（座位从 composer 里消失）。
契约里 `conversation.input.model` 是 single slot、`replaceRisk: shadows-shipped-ui`，
顶掉它意味着自己复刻整套菜单并长期跟版，收益不值。

另一个反直觉的坑：**判定目标必须取自设置段，不能取自 `listProviders()`** ——
后者正是过滤器的输出，拿它当目标，被隐藏的 provider 就再也不会进入下一轮探测，
「隐藏即永久」。同理，cordis 服务的方法**不能**用 `!==` 校验是否替换成功
（traceable 代理每次访问都是新对象），要看属性描述符。

## 本月用量（1.0.0 起）

`llm/stream` 的 `usage` chunk 在 finish 之前到达；本插件观察流时把每次
in / out / cacheRead / cacheWrite tokens 累加，finish 时一次性写入
storageDomain 的 per-record table。**不算钱** —— 开源 DSH 的 llm 服务只暴露
`imageRequestPricing`，没有 chat 文本定价接口；给每个 provider 写硬编码价目表
既过时又快塌。把 token 用量留给用户自己对照官方价目表定价。

设置 → 模型 → 页脚 order 80 处渲染成一张「本月用量」卡：
输入 / 输出 / 缓存 / 合计 tokens + 调用次数 + 前 5 个最常用模型。

- **导出 CSV**：按钮把全部记录写到剪贴板（id / provider / model / at / 各 token /
  finished），文件命名 `dsh-llm-hub-usage-YYYY-MM-DD.csv`。
- **清空记录**：POST + `window.confirm` 两段式，避免被预取或前进后退误删。

storageDomain 用**局部注入** —— 缺席时本插件其余功能（余额 / 可用性 /
harness）照常工作，没有用量统计只是少一张卡，不会让整个 boot 失败。

## 余额预警（1.0.0 起）

阈值在 `settings.dsh-llm-hub.warning`：

```yaml
dsh-llm-hub:
  warning:
    cashCNY: 10       # DeepSeek / moonshot / stepfun 等 cash 类，CNY 余额下限，默认 10 元
    planPercent: 10    # minimax / zhipu 等 plan 类，「余量」下限，默认 10%
```

新加 `/api/dsh-llm-hub/warning/check`：客户端把当前余额信封 POST 进来，host 半
按阈值判定，返回 `{ level: 'low'|null, text }`。**阈值数字不进响应** ——
这是服务端策略，不让前端能关掉；也不暴露 USD/USDT 之外的汇率换算细节。

余额数字低于阈值时变红 + 一枚 ⚠️ chip（鼠标悬停看具体提示）：
「DeepSeek 余额 ¥8.50 低于 10，充值一下」或「minimax 5h 余 8% 低于 10%」。

## Provider 健康看板（1.0.0 起）

设置 → 模型 → 页脚 order 70 处渲染成一张表，每行一个 provider：

| 列 | 含义 |
|---|---|
| 名称 | provider id + displayName |
| 状态 chip | `available`（绿）/ `unavailable`（红）/ `unknown`（灰） |
| 延迟 | 本次探测 `latencyMs`，探测没成则显示 `—` |
| HTTP | 上游状态码（401 / 402 / 5xx 一眼可分） |
| 原因 | 不可用/未知时给一句人话提示（截断 + title 出全文） |
| 探测时间 | 本地时间 `HH:MM:SS`，方便判断缓存新鲜度 |

数据来源 `/api/dsh-llm-hub/health`：复用 availability 的 verdict，附加
`latencyMs` 与 `status` 字段。`ensureAvailabilityFresh()` 触发后台重探
（5 分钟 TTL 过期），不阻塞响应。

「重新探测」按钮复用 `availability.recheck`，与下拉重探同一条底层刷新
路径 —— 不会双探。

## 智能路由建议（1.1.0 起；原 P1-5 改方案）

DSH 的 `conversation.input.model` 是 **single + user-controlled** slot
（`replaceRisk: shadows-shipped-ui`，README 已钉死），没有供插件改值的 setter。
**所以本插件不做自动切换**，只给建议 —— 让你在 Settings 页一眼看到
「如果现在要切，应该选哪个」。

设置 → 模型 → 页脚 order 75 处的「当前路由」卡：显示当前激活的 (provider, model)
+ 状态 chip、配置里的 primary 与 fallbacks[] 各自的可用状态。当 current 不可用时
卡片底部高亮「建议切换到 X」；全不可用时给一句人话 reason。

配置（settings.dsh-llm-hub.routing）：

```yaml
dsh-llm-hub:
  warning:
    cashCNY: 10
    planPercent: 10
  routing:
    primary: minimax/abab5.5-chat
    fallbacks:
      - deepseek-official/deepseek-chat
      - modelgo/gpt-4o
```

请求体（POST `/api/dsh-llm-hub/routing/resolve`）：

```json
{ "active": "modelgo/gpt-4o" }
```

返回：

```json
{
  "ok": true,
  "active": { "provider": "modelgo", "model": "gpt-4o", "state": "available" },
  "candidates": [
    { "provider": "minimax", "model": "abab5.5-chat", "state": "available" },
    { "provider": "deepseek-official", "model": "deepseek-chat", "state": "unavailable" },
    { "provider": "modelgo", "model": "gpt-4o", "state": "available" }
  ],
  "recommendation": { "provider": "minimax", "model": "abab5.5-chat" },
  "reason": null
}
```

判定语义：按 primary → fallbacks[] 顺序找第一个 `state === 'available'` 的
作为 recommendation；全不可用返 null + reason；未配置 routing 返 null +
「尚未在 settings.dsh-llm-hub.routing 配置主力模型 / fallbacks」。

为什么不做自动切换：DSH 的 composer 下拉是 session-scope 的 single slot，宿主
没暴露 setter；强行模拟键盘事件去点下拉既脆又破可访问性。「提示」+「一键跳」
的姿势比「替你点」更尊重用户当前的下一步动作。

## 模型别名（1.2.0 起）

把长 model id 翻成短显示名 —— `deepseek-reasoner` 渲染成 `推理 (deepseek-reasoner)`、
`claude-3.5-sonnet` 渲染成 `Sonnet (claude-3.5-sonnet)`。完整 id 永远在 title 里
（复制 id 粘到 settings.yaml 时不能是「推理」），但日常切模型眼睛扫得快。

配置（`settings.dsh-llm-hub.aliases`）：

```yaml
dsh-llm-hub:
  aliases:
    'deepseek-official/deepseek-reasoner': '推理'
    'modelgo/claude-3.5-sonnet': 'Sonnet'
    'modelgo/gpt-4o': 'GPT-4o'
```

key 形态：`provider/model`。provider 严格（要去 settings 段查），model 允许
`.`/`+`（DSH 真实 id 有 `claude-3.5-sonnet`、`deepseek-reasoner` 这种）。

值是空字符串 / 纯空白 / 非字符串 全部过滤；不会让「短名 = 」这种占位塞进 UI。

未配置 aliases 段时 UI 退回只显示 `model.id`，与没装本插件时一致。

## 多账号 key 轮换（1.3.0 起）

同 provider 配多把 key，每次解析连接时按 round-robin 选下一把（避免单把 key
撞 rate limit / 配额上限）。**不**自动跳过失败 key —— 用户从 debug 卡看到「上次
失败用的是 X」后，下次请求自然轮换过去；自动跳过失败 key 等 1.4 收集真实失败场景再加。

配置（`settings.dsh-llm-hub.keyPool`）：

```yaml
dsh-llm-hub:
  keyPool:
    deepseek-official:
      - name: primary
        env: DEEPSEEK_API_KEY_1
      - name: backup
        env: DEEPSEEK_API_KEY_2
      - name: rotated
        env: DEEPSEEK_API_KEY_3
    modelgo:
      - name: '轮换 A'
        env: MODELGO_KEY_1
      - name: '轮换 B'
        env: MODELGO_KEY_2
```

每条 entry 是 `{ name, env }`：name 是人话（debug 用），env 是凭据引用的环境变量名。
host 半直接 `process.env[ref]` 解出来 —— 不走 credentials 服务，因为这些 key
多半不会进凭据库（轮换场景通常是测试 / 临时 key，手贴环境变量更简单）。

向后兼容：未配 keyPool 段时走旧的 `apiKeyEnv` 单 key 路径，行为完全不变。显式
覆盖（`request.apiKey`）绕过轮换直接用它，索引不动。

设置 → 模型 → 页脚 order 73 处的「多账号 key 轮换」卡：每行一个 provider +
「N keys」元信息 + 当前轮到的 key 名（带 `#M / N · HH:MM:SS」的小标，鼠标悬停看 env 名）。
**不**显示 apiKey 实际值。

## 外部 harness 子代理（装了才出现）

把**本机已经装好**的外部 agent CLI 注册成 DSH 的子代理提供方，会话里就能把一段独立
任务甩给它们，各自烧各自的订阅额度：

| 工具 | 需要本机装 | 实际执行 |
|---|---|---|
| `subagent_codex` | `codex` | `codex exec --skip-git-repo-check <任务>` |
| `subagent_claude_code` | `claude` | `claude -p <任务>` |
| `subagent_antigravity` | `agy` | `agy -p <任务> --dangerously-skip-permissions` |

**没装的不会出现。** provider 只在对应可执行文件真的存在时才注册，而
`dsh-tool-subagent` 对缺失的 provider 只打一条 info、把工具行延迟到 provider 出现才
注册。所以在没装 codex 的机器上 `subagent_codex` 根本不进工具目录，宿主照常启动 ——
不需要任何开关或配置。

探测走 `ctx.subprocess.resolveExecutable`（内核自己的解析器，与子进程执行时同一套
PATH 视图），**不自己扫 PATH**：登录 shell 的 alias 会骗过 `command -v`（`agy` 常被
alias 成带 `--dangerously-skip-permissions` 的形式），而 launchd 起的宿主进程压根读
不到 `.zshrc` 里的 PATH。

### 几个钉死的边界

- **`agy` 必须带 `--dangerously-skip-permissions`**：headless print 模式下它会自动
  拒绝 `command` 权限，于是任何碰文件或命令的任务都 **exit 0 且零输出**。少这个 flag
  不报错，只让子代理「成功」地什么也没干。
- **exit 0 + 空输出一律报错**，不折成 `completed`：否则父 agent 拿着空答案往下走。
- **`codex` 带 `--skip-git-repo-check`**：父会话 cwd 不一定是 git 仓库，缺了直接拒跑。
- **stderr 只留 8 KiB 尾巴**：agy 的 glog 在日志目录不可写时能喷 300+ 行，不能全进父日志。
- 子进程**不继承父上下文**，也不声明任何 start 能力（persona / 工具过滤 / 深度上限 /
  结构化输出在另一个运行时里都管不到），如实声明让内核提前拒掉要这些能力的请求。

### 与官方 bundle、与 preset 手工行共存

- 官方的 `@deepseek-ai/dsh-subagent-codex` / `-claude-code` 注册的是同名 provider
  （`codex` / `claude-code`）。**先到的赢**：本插件遇到重名只记一行 info 跳过，剩下的
  继续注册。想让本插件统一提供，把那两个官方 bundle 从 profile 里移除。
- ⚠️ 如果你在 `~/.dsh/.agent-presets/*/agent.cordis.yml` 里手工加过
  `tool-subagent-codex` 这类行，**删掉它们** —— 同一个 `toolName` 不能注册两次。

### 为什么内核符号是动态 import

`@deepseek-ai/dsh-subagent` / `-session` 由宿主提供（profile 里经
`.dsh-module-fallback` 解析），**仓库目录里解析不到**。顶部静态 import 会两头挨打：
仓库内跑测试直接 `MODULE_NOT_FOUND`，线上一旦某个宿主版本少了其中一个导出，整个插件
加载失败 —— 连余额和模型发现一起没了。惰性载入把风险关在这一段里。探测与注册这条
启动路径完全不碰内核 import（空能力声明就地内联），只有真正 spawn 子进程时才载入。

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

## 开发

```sh
npm run check     # 两半语法
npm test          # 回归测试（node:test，零依赖）
npm run deploy    # 同步到 web profile
```

测试在 `test/`，零依赖（只用 `node:test` + `node:assert`），CI 里跑。每条用例都钉住一个
**真实踩过的坑** —— 判定链很长（凭据 → 探测 → 余额 → 运行期），任何一环退化都不会有编译
错误，只会静默地把能用的模型藏起来，或者把不能用的留在下拉里：

### 发布

推 `v*` tag 即触发 `.github/workflows/publish.yml`：先在发布前**再跑一遍**语法 + 回归测试 +
发布产物校验（不依赖「之前某次 CI 应该跑过了」），再 `npm publish`，最后在 Release 缺失时
按 CHANGELOG 对应小节建。需要在仓库 secret 里配 `NPM_TOKEN`。

漏发或失败可以手动补，不用重推 tag：

```sh
gh workflow run publish.yml -f tag=v0.7.0
```

幂等由两道判断保证 —— tag 必须与 `package.json` 的 version 一致；npm 上已有该版本就跳过
publish。Release 的存在性单独探测，所以「npm 发成功但 Release 没建起来」也能靠重跑补上。

- **host 半** `lib/index.js`：ESM（cordis loader 按 ESM 读）。
- **client 半** `lib/client.js`：**源码即产物**，classic script（无顶层 import/export），
  经 `window.__ModuleLoader__.load({ id, factory })` 注册。`id` **必须与 package.json 的
  `name` 完全一致**，否则 DSH 拒绝注册。React 由 `factory(require)` 提供，不打包进产物。
  当前体量无需构建步骤；若将来拆多文件，再加 esbuild（`format: 'iife'`，React 等标 external）。

## 🧩 Webkubor DSH 精选扩展家族 (Plugin Suite)

打造极致的 DeepSeek Harness 开发者与用户套件：

| 插件 | 领域 | 核心功能 | 快速安装 |
| :--- | :--- | :--- | :--- |
| [🎨 **dsh-bloom-theme**](https://github.com/webkubor/dsh-bloom-theme) | 主题美化 | 现代毛玻璃美学、暗黑/亮色自适应与 20+ 精选艺术壁纸 | `dsh plugin install @dsh-plugins/dsh-bloom-theme` |
| [⚡ **dsh-llm-hub**](https://github.com/webkubor/dsh-llm-hub) | 智能路由 | 多模型厂商聚合、秒级切换与故障智能重试 | `dsh plugin install @dsh-plugins/dsh-llm-hub` |
| [🪞 **dsh-user-mirror**](https://github.com/webkubor/dsh-mirror) | 角色记忆 | 用户数字画像、习惯偏好与记忆沉淀网络 | `dsh plugin install @dsh-plugins/dsh-user-mirror` |
| [🖥️ **dsh-env-inspector**](https://github.com/webkubor/dsh-env-inspector) | 运行环境 | 活跃端口一键释放、CLI 工具链与开发凭据大屏 | `dsh plugin install @dsh-plugins/dsh-env-inspector` |

---

## License

MIT
