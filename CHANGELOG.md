# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
