# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.5.1] - 2026-09-15

### 修复

- README 里有两段互相矛盾的安装说明，首屏那段还写着 `cd ~/.dsh/profiles/web && npm i`
  —— 写死了作者自己的 profile 名，别人照抄会装到错地方。现在只留一处正确的。
  同时删掉「升级到 0.2.0 后的验证」这份三个版本前的一次性清单。

## [0.5.0] - 2026-09-15

### 新增

- **pi-ai 行显示协议与接入地址**。这两项决定了这个 provider 到底连去哪、用哪套报文
  （`openai-completions` / `anthropic-messages` / …），出问题时第一眼要看的就是它们，
  之前只能去翻 `settings.yaml`。协议直接显示；地址只显示域名，完整 URL 放 `title` ——
  一行放不下，而域名已经够回答「连的是不是我以为的那个网关」。

- **页脚「分享插件」**。复制的是一段完整说明：一句介绍 + 三步安装 + 仓库链接，
  发给别人就能照着装上。

### 修复

- 分享文案原先是 `cd ~/.dsh/profiles/web && npm i dsh-llm-hub` —— 写死了我自己的
  profile 名，而且**装进 node_modules 不等于接进 boot graph**：少了
  `dsh.profile.bundles` 那行，插件根本不会加载。对方照着做装不上，等于分享没用。
  README 的安装段同步改成 `dsh plugin --profile <name> add`。

## [0.4.1] - 2026-09-15

### 新增

- **模型页页脚：版本 + GitHub + 问题反馈**。别的 DSH 插件都有反馈入口，这个没有——
  用户遇到问题无处可说，闭不上环。新增 `GET /api/dsh-llm-hub/meta` 返回包名、版本、
  仓库与 issues 地址，页脚（`settings.models.footer`）渲染成一行。

  版本号从 `package.json` 读，**不在前端硬编码**——硬编码的版本每次发版都要记得改，
  而忘记改的那次没人会发现。

### 修复

- meta 路由第一版写了 `require('../package.json')`，本包是 ESM（`type: module`），
  装上去直接 `require is not defined`。改用 `import.meta.url` + `readFileSync`。
  这类错只在运行时暴露，语法检查看不出来。

## [0.4.0] - 2026-09-15

拉到了目录却只能「复制全部 id」——最后一公里一直留给人自己粘。这版把它走完。

### 新增

- **目录选择器**：拉取目录后直接列出网关在售的模型，逐个勾选，点「保存到配置」
  写回 `llm-pi-ai.providers.<id>.models`。已配置的默认勾上并标注，人只需要动增量。
- **已知网关默认地址**：settings 里没填 baseURL 时，用服务商的官方地址兜底
  （智谱国内/国际、MiniMax、Moonshot、StepFun）。自建网关不进这张表——它们的
  地址因人而异，猜不得。
- `status` 增加 `modelIds`（已配置的 id 列表，前端据此默认勾选）与 `baseURLSource`
  （`settings` / `known` / `none`，用来区分地址是人填的还是兜底来的）。

### 变更

- **目录拉取不再只对 modelgo 开放**。「网关上到底有哪些模型」对每个 provider 都有用：
  智谱手填 8 个、网关在售 16 个，不拉一次根本不知道漏了什么。
- 智谱不再显示「未配置 baseURL，无法探测」。这句话和「余额查得通」同时出现过——
  同一个 provider，余额那条路知道它在哪（适配器自带 hostFor），探测这条路说不知道。
  两边现在共用同一张已知网关表。
- 文案继续去技术化：「未配置 baseURL，无法探测；模型为手填目录」→
  「没填服务地址，探测不了；模型只能手填」。

### 写入纪律

唯一的写操作，只接受 POST + 同源，且**只动 `models` 一个字段**：已配置模型的
`contextWindow` / `maxTokens` / `input` / `reasoningEfforts` 等人填的定义原样保留，
不会因为一次勾选被抹平。实测勾选 MiniMax-M2.7 保存后，MiniMax-M3 的完整定义一字未动。

## [0.3.1] - 2026-09-15

### 修复

- **「状态读取失败」满屏**：`status === null` 是「还没拉回来」的初始态，却和真失败
  共用一个分支。页面一打开、或 DSH 刚重启导致这次 fetch 断掉时，每一行 pi-ai 都写着
  「状态读取失败」，看着像插件坏了。现在加载中显示「读取中…」，只有真失败才报失败。

## [0.3.0] - 2026-09-15

### 新增

- **provider 余额 / 配额卡**：pi-ai 行下方显示各家的余量，四个适配器：
  | provider | 接口 | 显示 |
  |---|---|---|
  | minimax | `/v1/token_plan/remains` | 套餐余量百分比（日 / 周） |
  | zhipu | `/api/monitor/usage/quota/limit` | coding 套餐配额 |
  | moonshot | `/v1/users/me/balance` | 现金余额 |
  | stepfun | `/v1/accounts` | 现金 + 代金券 |

  自建网关（ModelGo 等）没有开放计费路由，如实报「不支持」，**绝不猜端点**。

  > ⚠️ 这个功能的代码其实在 0.2.0 就已随包发布，但当时被误提交进一个标题为
  > `docs: 0.2.0 发版材料` 的 commit（`git add -A` 把工作区里的代码一起带走了），
  > CHANGELOG 与 README 都没提过它。此处补记，并正式计入 0.3.0。

### 修复

- **zhipu 的余额接口从来没通过**：`path: () => '/api/monitor/...'` 把 base 参数整个
  丢掉，于是 `hostFor` 明明给对了 `https://open.bigmodel.cn`，fetch 拿到的仍是相对
  路径，直接抛 `Failed to parse URL`。补回 base 后正常返回上游的
  「当前用户不存在coding plan」。
- **错误提示不再暴露技术细节**。设置页是给用人看的，之前卡片上直接印
  `could not reach /api/monitor/usage/quota/limit: Failed to parse URL from ...`,
  读的人既不知道发生了什么，也不知道该做什么。现在 `reason` 一律是人话
  （「未填写服务地址，查不了余额」「连不上服务商」「API key 可能无效或没有查询余额的
  权限」「这家服务商没有提供余额查询接口」），技术细节移到不展示的 `detail` 字段。
- 拼出的 URL 不是绝对地址时提前拦截并给出人话 —— 适配器是一张表，表里任何一行
  写错都不该让用户看见一句 `Failed to parse URL`。

## [0.2.3] - 2026-09-14

纯文档版本，代码零改动。

### 变更

- README 首屏从 66 行压到 34 行。0.2.1 那版按基线补齐了要素，但**把要素堆满了首屏**：
  5 个 for-the-badge 大徽章挤成一排（其中「0/month 下载量」「runtime deps 0」反而减分）、
  中文页里还压着一整行英文副标题、"三个能力"三条长句换行后糊成一团。
- 现在首屏只留四样：banner、三枚细徽章、一张对比矩阵、一个安装命令。
  对比矩阵去掉 ✅/❌ 图标改用文字对照，列更齐、扫读更快。
- 三条能力的内容并入对比矩阵，不再重复讲一遍。

## [0.2.2] - 2026-09-14

纯品牌资产版本，代码零改动。

### 新增

- **Banner**（1600×500）与 **Logo**（512×512）—— 开源基线要求的品牌资产，此前缺失。
  设计不用氛围图：banner 右侧是产品真实输出的抽象化（三个 provider 的探测结果：
  绿点/灰点、模型数、延迟），logo 是探测波纹 + 发光核心。与同宿主的
  dsh-bloom-theme 保持深色基调，但视觉元素是本项目自己的灵魂而非配色展示。
- README 首图换成 banner，产品截图移到「用法」段（各司其职：首图讲定位，截图证明输出）

## [0.2.1] - 2026-09-14

纯文档版本，代码零改动。

### 变更

- README 按开源项目基线重写（`cs rule open_source_project_baseline` 的 README 金字塔）：
  产品截图首图 + 居中标题与定位 + 徽章 + 「为什么需要它」对比矩阵 + 三条能力 + 30 秒上手，
  技术细节全部保留、移到首屏以下
- Quickstart 改成**可直接运行**的真实步骤（含接入 `dsh.profile.bundles` 那一步，
  漏掉它插件装了也不加载）
- 中英文 README 结构对齐

## [0.2.0] - 2026-09-14

给 `llm-pi-ai` 段里的每个 provider（modelgo / minimax / zai-coding-cn …）补上官方
适配器天然做不到的那一半：**网关到底通不通、上面到底有多少模型**。

官方 pi-ai 适配器占着自己的 discovery 坑，而 `LISTABLE_PROTOCOLS` 又不含
`anthropic-messages` —— modelgo 这类网关的「获取可用模型」按钮天生失效。本版旁路补上，
不与官方适配器竞争注册。

### 新增

- **网关可达性探测**：provider 卡片下方常驻一行 `pi-ai · 显示名 · 已配 N 个模型 · Key ✓/✗`，
  点「探测网关」实测延迟与在售模型数
- **目录拉取**：modelgo 等支持目录的网关可一键拉全量模型 id，并「复制全部 id」
- **说清为什么不能探测**：没配 `baseURL` 的 provider 直接写明「无法探测；模型为手填目录」，
  而不是转圈或静默
- 三个只读接口：`/api/dsh-llm-hub/pi-ai/{status,probe,catalog}?provider=<id>`

![pi-ai 行：可达性探测与目录拉取](https://img.webkubor.online/oss/dsh-llm-hub/models-piai-cards.png)

### 修复

- **pi-ai 行曾整个不渲染**：宿主 `settings.models.provider-card` 传进来的 `provider`
  是 entry 对象（`{ provider, displayName, settingsNs, … }`），而组件按字符串取值，
  拿到对象就 `return null`。三个 API 端点全通、插件版本也对，页面上却什么都没有，
  控制台无报错 —— DeepSeek 那张卡不读这个字段，所以看不出问题。现已两种形态都接。

### 已知限制

- 拉取到的模型目录只能看和复制，**还不能勾选写回 settings**；协议与 baseURL 也未在行内展示。
  两项都在 0.3.0 计划中。

## [0.1.0] - 2026-09

- **DeepSeek 官方直连的模型发现**：自动拉取可用模型，免去手填
- **余额与可用性**：Models 页 DeepSeek 卡片下方常驻余额行，可手动刷新

![DeepSeek 卡片上的余额行](https://img.webkubor.online/oss/dsh-llm-hub/models-deepseek-balance.png)
