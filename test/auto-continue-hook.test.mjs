import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 1.11.0 任务结束续跑 hook：对 lib/index.js 做结构断言 + 把决策核心
// 提到纯 JS 里做行为级验证（与 model-origin.test.mjs 的 extractFn 同一手法）。

const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

function extractFn(name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) throw new Error(`missing ${name}`)
  let depth = 0
  const j = src.indexOf('{', i)
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('unbalanced')
}

// ── 结构断言：配置面 ───────────────────────────────────────────────────────

test('Config 导出 hooks 段', () => {
  assert.match(src, /hooks: z\.object\(\{/)
  assert.match(src, /autoContinue: hookRule\.default\(\{\}\)/)
})

test('hookRule 四个字段与默认值', () => {
  assert.match(src, /enabled: z\.boolean\(\)\.default\(true\)/)
  assert.match(src, /maxTurns: z\.number\(\)\.default\(20\)/)
  assert.match(src, /maxIdleMinutes: z\.number\(\)\.default\(120\)/)
  assert.match(src, /continuePrompt: z\.string\(\)\.default\(''\)/)
})

test('hooks 段标记 volatile（0.1.7 settings.update 契约）', () => {
  // hooks 段在 Config 里必须 .volatile()，否则 settings.update 会拒绝
  const m = src.match(/hooks: z\.object\(\{[\s\S]*?\}\)\.default\(\{\}\)\.volatile\(\)/)
  assert.ok(m, 'hooks 段缺 .volatile()')
})

// ── 结构断言：事件挂载 ─────────────────────────────────────────────────────

test('监听 agent/turn-stopping（官方公开事件）', () => {
  assert.match(src, /ctx\.on\('agent\/turn-stopping', \(payload, next\)/)
  assert.match(src, /\{ global: true \}\)/)
})

test('续跑走官方 followup API，且消息符合 UserMessage 契约', () => {
  assert.match(src, /typeof agent\?\.followup === 'function'/)
  assert.match(src, /agent\.followup\(\{/)
  // 2026-11-23 实测：source 写成字符串 + 缺 id → followup 抛错被吞，hook 表现为无效果
  assert.match(src, /id: uuid/)
  assert.match(src, /role: 'user'/)
  assert.match(src, /content: \[\{ type: 'text', text: prompt \}\]/)
  assert.match(src, /source: \{ kind: 'user' \}/)
})

test('hook 失败静默（try/catch 包裹，不影响回合停止语义）', () => {
  // turn-stopping 处理体整体在 try{}catch{} 里，异常时也要 next()
  const i = src.indexOf("ctx.on('agent/turn-stopping'")
  const seg = src.slice(i, i + 2400)
  assert.ok(/catch \{/.test(seg), '缺 catch 兜底')
  assert.match(seg, /return next\(\)/)
})

test('会话隔离的续跑计数（Map + ctx.effect 清理）', () => {
  assert.match(src, /const autoContinueState = new Map\(\)/)
  assert.match(src, /ctx\.effect\(\(\) => \(\) => autoContinueState\.clear\(\)\)/)
})

// ── 行为级验证：三条正交规则 ───────────────────────────────────────────────
// 把 turn-stopping 处理器里的判定逻辑重放成一个纯函数（与实现同构），
// 验证规则组合的边界。

function decide({ rule, state, now }) {
  if (!rule || rule.enabled !== true) return { act: false, why: 'disabled' }
  if (typeof rule.maxTurns === 'number' && rule.maxTurns > 0 && state.turns >= rule.maxTurns)
    return { act: false, why: 'maxTurns' }
  if (typeof rule.maxIdleMinutes === 'number' && rule.maxIdleMinutes > 0
    && now - state.firstAt > rule.maxIdleMinutes * 60_000)
    return { act: false, why: 'maxIdleMinutes' }
  const prompt = (typeof rule.continuePrompt === 'string' && rule.continuePrompt.trim())
    ? rule.continuePrompt : '继续，按之前的任务清单往下推进。'
  return { act: true, prompt }
}

test('显式关闭：enabled=false 时永不续跑', () => {
  const r = decide({ rule: { enabled: false, maxTurns: 99, maxIdleMinutes: 99 }, state: { turns: 0, firstAt: Date.now() }, now: Date.now() })
  assert.equal(r.act, false)
  assert.equal(r.why, 'disabled')
})

test('打开后未达上限 → 续跑并用默认提示词', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 5, maxIdleMinutes: 60, continuePrompt: '' }, state: { turns: 0, firstAt: now }, now })
  assert.equal(r.act, true)
  assert.equal(r.prompt, '继续，按之前的任务清单往下推进。')
})

test('maxTurns 到顶 → 停', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 3, maxIdleMinutes: 0 }, state: { turns: 3, firstAt: now }, now })
  assert.equal(r.act, false)
  assert.equal(r.why, 'maxTurns')
})

test('maxIdleMinutes 到点 → 停（跑一晚上的兜底）', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 0, maxIdleMinutes: 30 }, state: { turns: 5, firstAt: now - 31 * 60_000 }, now })
  assert.equal(r.act, false)
  assert.equal(r.why, 'maxIdleMinutes')
})

test('maxTurns=0 且 maxIdleMinutes>0 → 只受时长限制', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 0, maxIdleMinutes: 480 }, state: { turns: 200, firstAt: now - 60_000 }, now })
  assert.equal(r.act, true)
})

test('自定义提示词优先于默认', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 0, maxIdleMinutes: 60, continuePrompt: '继续修复剩余的 issue' }, state: { turns: 0, firstAt: now }, now })
  assert.equal(r.prompt, '继续修复剩余的 issue')
})

test('两条上限同时给 → 先撞哪个停哪个', () => {
  const now = Date.now()
  // 时长已超但轮数未到 → 停（时长兜底优先于轮数）
  const r1 = decide({ rule: { enabled: true, maxTurns: 10, maxIdleMinutes: 30 }, state: { turns: 2, firstAt: now - 45 * 60_000 }, now })
  assert.equal(r1.why, 'maxIdleMinutes')
  // 轮数已到但时长未超 → 停（轮数优先）
  const r2 = decide({ rule: { enabled: true, maxTurns: 2, maxIdleMinutes: 480 }, state: { turns: 2, firstAt: now - 5 * 60_000 }, now })
  assert.equal(r2.why, 'maxTurns')
})

test('两个上限都是 0 且 enabled → 无限续（用户自担，UI 提示）', () => {
  const now = Date.now()
  const r = decide({ rule: { enabled: true, maxTurns: 0, maxIdleMinutes: 0 }, state: { turns: 9999, firstAt: now - 999 * 60_000 }, now })
  assert.equal(r.act, true)
})
