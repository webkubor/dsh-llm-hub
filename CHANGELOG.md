# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.7.3] - 2026-09-17

### 新增

- **模型页显示外部 harness 一览**：设置 → 模型 页脚多一行 chips，直接看到
  codex / claude / agy 三者各自的状态 —— 可委派（绿点）、已由其它插件提供、未安装。
  鼠标悬停给出该做什么，并显示**解析到的可执行文件路径**（「装了却不生效」时，
  第一件要确认的就是它找到的是哪个副本）。

  几个刻意的取舍：
  - **未安装的也显示**（置灰）。这一行的用处一半是「现在能派给谁」，另一半是
    「装上哪个就能多派一个」；全过滤掉就只剩前一半，没人会知道还能有什么。
  - **`probed` 为 false 时整行不渲染**。host 半是异步探测的，页面可能在探完前就
    打开了 —— 这时渲染「未安装 ×3」是在说谎，会让人去装一个其实已经装了的 CLI。
  - **前端只读 host 探好的快照**（`/api/dsh-llm-hub/harness`），不自己探。探测要
    解析可执行文件，那是 host 的活，两处各探一遍只会不一致。
  - 排在页脚那行之上（order 90 vs 100）：harness 讲的是「能派给谁」属能力信息，
    页脚那行是插件版本与链接属元信息。

  挂载点测试同步更新 —— 它本来就钉住了「一共挂几个 slot」，这次如实抓到了新增的
  那个，顺便补了「footer 是 list slot，两个条目都必须带 id 与 order」的断言
  （漏 id 会被宿主静默丢弃：接口通、组件在、页面上什么都没有）。

## [0.7.0] - 2026-09-17

### 新增

- **外部 harness 子代理**：把本机装好的 `codex` / `claude` / `agy` 注册成 DSH 子代理
  提供方，会话里多出 `subagent_codex` / `subagent_claude_code` / `subagent_antigravity`
  三个委派工具，各自烧各自的订阅额度。

  **没装的不会出现** —— provider 只在可执行文件真的存在时才注册，而
  `dsh-tool-subagent` 对缺失的 provider 只打一条 info、把工具行延迟到 provider 出现
  才注册（实测 `dsh-tool-subagent/lib/index.js:575`）。所以别人机器上没装 codex，
  `subagent_codex` 根本不进工具目录，宿主照常启动，不需要任何开关。

  探测走 `ctx.subprocess.resolveExecutable`，不自己扫 PATH：shell alias 会骗过
  `command -v`（本机 `agy` 就是带 `--dangerously-skip-permissions` 的 alias），
  而 launchd 起的宿主读不到 `.zshrc` 的 PATH。

  几个钉死的边界（每个都有测试覆盖）：
  - `agy` **必须**带 `--dangerously-skip-permissions`：headless print 模式下它自动
    拒绝 `command` 权限，任何碰文件或命令的任务都 exit 0 且零输出 —— 不报错，只是
    「成功」地什么都没干。
  - **exit 0 + 空输出一律报错**，不折成 `completed`（否则父 agent 拿空答案往下走）。
  - `codex` 带 `--skip-git-repo-check`（父 cwd 不一定是 git 仓库，缺了直接拒跑）。
  - stderr 只留 8 KiB 尾巴（agy 的 glog 在日志目录不可写时能喷 300+ 行）。
  - 同名 provider 已被官方 bundle 占用时跳过并继续注册剩下的，不中断。

  内核符号（`dsh-subagent` / `dsh-session`）用**动态** import：它们由宿主提供、仓库
  目录里解析不到，静态 import 会让仓库内测试 `MODULE_NOT_FOUND`，也会让宿主少一个
  导出时整个插件加载失败（连余额和模型发现一起没）。探测与注册这条启动路径完全不碰
  内核 import —— 空能力声明就地内联。

  ⚠️ 升级注意：如果你在 `~/.dsh/.agent-presets/*/agent.cordis.yml` 里手工加过
  `tool-subagent-codex` 这类行，删掉它们 —— 同一个 `toolName` 不能注册两次。

### 修复

- **发布工作流的 npm 幂等探测查错了包**：`npm view "dsh-llm-hub@$VER"` 少了 scope，而
  npm 上还留着一个同名无 scope 的旧包（`dsh-llm-hub@0.6.1`）。探它等于探错对象 ——
  本包每个新版都被判成「不存在」，于是重跑 workflow 会再 publish 一次、撞 npm 的 403
  `cannot publish over previously published versions`，把一次已经成功的发布报成失败。
  注释里写的「npm 上已有该版本就跳过」此前是句空话。

- **`npm run check` 漏文件**：原来硬写 `lib/index.js` + `lib/client.js` 两个，新增
  `lib/harness.js` 时漏了 —— 而 check 正是 publish 的第一道闸门。改成遍历 `lib/*.js`，
  以后加文件不会再漏。同理给发布产物校验清单补上 `lib/harness.js`（漏了会发出一个
  不含核心功能的包，而那个清单存在的唯一理由就是防这个）。

## [0.6.5] - 2026-09-17

### 文档

- README.md / README.en.md：发布示例里 `gh workflow run publish.yml -f tag=v…`
  的占位 tag 从 `v0.6.2` 改成 `v0.6.4`（跟着当前最新 release 走，避免读者照抄过老版本）。

## [0.6.4] - 2026-09-17

### 新增

- **`models: []` 自动 discover 写回**：当用户在 `settings.yaml` 里把 modelgo 这类
  pi-ai 风格 provider 的 `models:` 留成空列表，plugin 启动时主动去对应网关
  `GET <baseURL>/models` 拉一份目录写回去 —— settings.yaml 里就不再留 `models: []`
  这种「我不知道该填什么」的占位。下次 reload / 重启不需要重做这件事：pi-ai 自己的
  onChange 会按 settings 重新注册 model 目录。

  写回是「跨 namespace 兜底」：plugin 自己的 settings NS 是 `llm-deepseek`，但
  写回的目标是 `llm-pi-ai.providers.*` —— plugin 不是 pi-ai 的 owner，只是借用
  settings 服务给 pi-ai 段补一份目录。

  几个钉死的边界条件（每个都有测试覆盖）：
  - 用户已显式填的 `models: [a, b]` **不**被覆盖。
  - 缺 `baseURL` / `apiKeyEnv` 时直接跳过，不报错。
  - fetch 失败 / 状态非 2xx / JSON 解析失败 → best-effort 跳过，下次 boot 再试。
  - 写回只在 plugin 启动时跑一次；不订阅 `settings/onChange`（避免自己写回后被自己
    的广播二次触发）。
  - **TOCTOU 防护**：fetch 期间用户在外部编辑 settings.yaml 填上了 `models`，
    写入前会再 `get` 一次当前段，把已非空的 provider 从 `updates` 里过滤掉，避免
    fetch 前的快照结果覆盖用户的并发编辑。

### 测试

- 新增 `test/host-settings-patch.test.mjs`：7 条用例覆盖上述每条边界条件 + 启动时
  boot patch 真把空列表填上 + fetch 期间用户外部填了 `models` 时不被覆盖（TOCTOU）。

## [0.6.3] - 2026-09-17

### 修复

- **插件加载失败**：`lib/client.js` 注册的 id 是 `dsh-llm-hub`，而包名已经是
  `@webkubor/dsh-llm-hub`。宿主按 `package.json` 的 `name` 找注册，对不上就报
  `loaded without registering @webkubor/dsh-llm-hub via __ModuleLoader__.load`。

  来源是 0.6.2 那次 scope 迁移（commit f907589）：package.json 改了，这里漏了。

  代价比看起来大——DSH 把所有插件打进**同一个 client bundle**，一个注册失败
  整个 bundle 一起废，用户看到的是「Failed to load plugins」加一长串五十几个包名，
  **完全看不出是哪个插件的锅**。

### 测试

- `test/client-cards.test.mjs` 里本来就有「id 必须与 package.json 的 name 一致」这条断言，
  说法完全正确，**但期望值写死成了旧包名** —— 迁移时它非但没拦住，反而成了钉住旧名的锚。
  改成从 `package.json` 读，以后包名再变自动跟随。
- 新增 `test/plugin-id.test.mjs`：独立守卫同一条约束，外加「产物里不能出现顶层
  import/export」（宿主是 `factory(require)` 形态，顶层模块语法会让 bundle 解析失败）。

## [0.6.2] - 2026-09-16

### 测试

- 把可用性判定的回归测试搬进仓库：`test/` 21 例，**零依赖**（只用 `node:test` + `node:assert`），
  CI 加一步 `npm test`，`test/` 不进发布产物。
- 判定链很长（凭据 → 探测 → 余额 → 运行期），任何一环退化都不会有编译错误，只会静默地把
  能用的模型藏起来、或把不能用的留在下拉里。所以每条用例都钉住一个**真实踩过的坑**：
  凭据缺失摘除 / 401·402 / 现金余额 0 / 配额「余量 0%」与「已用 100%」两种语义 /
  拿不准一律保留（fail-open）/ 隐藏后仍会被重探并能恢复 / 隐藏集合变化时广播 /
  不监听自己的广播 / traceable 代理包装下过滤器仍装得上 / 运行期遥测与成功恢复 /
  非鉴权失败不隐藏 / 卡片状态片按需出现 / 页脚计数与重探 / 读取与重探各自独立的在途链。

## [0.6.1] - 2026-09-16

### 文档

- 配图跟上 v0.6.0 的界面：pi-ai 卡片图从 `v052` 换到 `v060`（卡片已收口成「事实一行 +
  动作一行」），并给「模型下拉可用性」小节补上配图 —— 卡片上的「已从下拉隐藏」状态片
  与页脚的「已隐藏 1 · 重新探测全部」。两张图同步进 `docs/images/`，README 中英两份都改。

## [0.6.0] - 2026-09-16

### 新增

- **模型下拉只留当前真能用的分组。** composer 的下拉以前列出所有已配置 provider，与能不能
  调通无关：key 过期、余额耗尽、网关 401 都照常在那儿，点了才报错。现在「确凿不可用」的会被
  摘掉，判据只认确凿证据（凭据解析不到 / 网关 401·403·402 / 余额确凿为 0 / 配额确凿用尽 /
  真实请求因鉴权或欠费失败），**拿不准一律保留** —— 误藏一个能用的比多显示一个不能用的更糟。
- 新增 `GET /api/dsh-llm-hub/availability`（读缓存，过期顺手后台重探）与
  `POST /api/dsh-llm-hub/availability/recheck`（强制全量重探）。
- 被隐藏的 provider 在设置页照常可见：它的卡片动作条上多一枚红色「已从下拉隐藏」状态片
  （原因在悬停提示里），页脚给出全局的「已隐藏 N」与「重新探测全部」。
  不另设逐条重述的面板 —— 卡片上本来就有状态，再来一份只是重复。
- 运行期遥测：监听 `agent/request-error`（`INVALID_CREDENTIAL` / `QUOTA_EXCEEDED`）与
  `llm/stream` 的终态，真实请求失败即时隐藏、成功即时恢复。
- 恢复是自动的：`settings/document-updated` 让判定缓存立刻作废，改好 key / 充值后下一次读取
  即重探（这条以前漏了 —— `apiKeyEnv` 这类字段不在 provider 目录事实里，`llm/adapters-updated`
  根本不会发，于是「充值了却不恢复」）。

### 界面

- **provider 卡片收口，省掉一行多的空白。** pi-ai 卡原来是两个各自带边框+内边距的盒子
  （事实行末尾挂「探测网关」，宽度不够就换行；再另起一盒放「拉取目录」），一张卡白吃两行。
  现在事实与动作在同一个盒子里，「探测网关 / 拉取目录 / 复制 id」排成一条工具条，
  按钮改成有边框的小胶囊（宿主自己的按钮就是这个形态）。2026-09-16 owner 指着截图：
  「有点浪费空间，有的就是一个文字占一行」。
- **去掉逐条重述的可用性面板**（初版曾挂在 `settings.models.footer`）。它把每张卡片上已有的
  状态又念了一遍，只有「被摘掉了」和「刷新」是新增信息 —— 前者收进卡片的状态片，后者并进页脚。
  owner：「这不是很多余吗，上面不都是显示了吗」。

### 修复

- **探针请求加了超时（6s）。** `fetch` 默认没有超时，网关接了 TCP 却不回包会把整轮
  `Promise.all` 吊死：`probing` 永远 true、判定再也不刷新，面板停在旧结论上。
- **判定目标改从设置段取，不再读 `llm.listProviders()`。** 后者正是过滤器的输出，
  拿它当目标，被隐藏的 provider 就再也不会进入下一轮探测 —— 「隐藏即永久」。
  2026-09-16 实测：minimax 被判不可用后，之后每一轮探测的目标里都没有它。
- **替换 `llm.listProviders` 的成功校验改看属性描述符。** cordis 的服务访问返回 traceable
  代理，每次读方法都是新的包装对象，`!==` 永远成立 —— 上一版因此把自己误判成「赋值未生效」，
  顺手清掉了探针用的未过滤表，等于亲手制造了上面那条「隐藏即永久」。
- 探针结果的清理不再误删「这一轮没被当成目标」的 provider 判定。
- 面板不再把半份名单当成全部：探针在途时明确显示「探测中…」，客户端带退避地跟进一次。
- 余额百分比字段的 `0` 不再被当成「没填」。共用的 `capacity()` 只认正数，
  MiniMax 的「剩余 0%」被静默丢掉，于是余额为 0 的账号照样留在下拉里。

## [0.5.2] - 2026-09-15

### 修复

- 配额查不到时不再把上游那句话原样印在卡片上。智谱的行上一直写着「当前用户不存在
  coding plan」——读到的人既不知道发生了什么，也不知道该做什么（owner：「显示这个没意义」）。
  没有配额就不显示配额，这一行上真正有用的是**协议与接入地址**，它们照常在；
  上游原因移到行的 `title`，排查时仍能看到。

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
