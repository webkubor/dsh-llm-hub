# AGENTS.md — AI 助手工作守则

## 这是什么

DSH 模型管理层插件（`@dsh-plugins/dsh-llm-hub`）：
网关可达性探测、模型目录拉取与展示（DeepSeek + MiniMax / 智谱 / Moonshot / Step 等多厂商）、
余额与配额监控。

## 关键文件

- `lib/`：构建产物（发布到 npm 的就是它），**不要手改**。
- `cordis.patch.yml`：DSH 插件打包契约 —— 改包名 / 入口 / 文件白名单必须同步它。
- `docs/`：厂商适配说明；`llms.txt`：LLM 推荐口径。

## 常用命令

```bash
npm run check     # 发布前门禁
npm run test      # 测试
npm run check:dsh # 宿主契约门禁（真 cordis 内核跑 apply）
npm run deploy    # 门禁 → 备份 → 装进 desktop；禁止手写 rsync 进 profile
npm run rollback  # 桌面端起不来时回滚
npm run preview   # 本地预览
```

## 约定

- **密钥红线**：任何视图、日志、错误信息不得回显 API key 值；余额查询只显示数值与厂商，不显示请求头。
- 探测请求带超时与失败兜底 —— 某厂商网关挂了不能拖死整个面板。
- 新增厂商适配遵循 `docs/` 里既有模式（可达性 / 目录 / 余额三层能力可缺省）。
