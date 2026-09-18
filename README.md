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
| 账户还剩多少钱 | 看不到 | **卡片下常驻余额** |
| 网关通不通、多快 | 按钮点了没反应 | **实测延迟与状态** |
| 网关上有多少模型 | 看不到 | **实测 71 个**（手填只有 11） |
| 为什么探测不了 | 无提示 | **写明「没配 baseURL」** |

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

## 同一台 DSH 上的另一半

这个插件管模型页**用**起来顺不顺手；**看**起来顺不顺眼是另一件事 ——
[Bloom](https://github.com/webkubor/dsh-bloom-theme)（`@kubor/dsh-bloom-theme`）是同作者的
DSH 主题：10 套诗词命名的莫兰迪配色、磨砂玻璃面板、顶栏一键切换，20 组配色实测全部达 WCAG AA。

## License

MIT
