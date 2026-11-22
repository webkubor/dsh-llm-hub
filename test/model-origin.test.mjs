import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// lib/client.js 是发布产物但本仓直接编辑它（无 src），测试直接对源做结构断言。

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('ModelOriginLabel 组件存在且使用宿主槽 props', () => {
  assert.match(src, /function ModelOriginLabel\(props\)/)
  // 读取的宿主字段
  assert.match(src, /props\.provider \|\| \{\}/)
  assert.match(src, /props\.model \|\| \{\}/)
  // placement !== 'option'（即 trigger）时只渲染名字，不加徽标
  assert.match(src, /placement !== 'option'/)
})

test('conversation.input.model.label 槽已注册', () => {
  assert.match(src, /ctx\.slots\.inject\('conversation\.input\.model\.label'/)
  assert.match(src, /id: 'dsh-llm-hub\.model-origin'/)
})

test('providerShortName 规则：账号/API 分流', () => {
  // 抽函数体单测不了（IIFE 内部），断言关键分支存在 + 行为语义写在源里
  assert.match(src, /function providerShortName\(providerName, providerId\)/)
  assert.match(src, /账号\|account\|subscription/)
  assert.match(src, /\^deepseek\/i\.test\(providerId\)/)
})

test('样式类已加入 ensureStyle', () => {
  assert.match(src, /\.dshllmh-model-origin\{/)
  assert.match(src, /\.dshllmh-model-origin__tag\{/)
})

test('zh/en 词典都含 model-origin 词条', () => {
  assert.match(src, /'model-origin\.via': '来源：\{provider\}'/)
  assert.match(src, /'model-origin\.via': 'via \{provider\}'/)
})

// 行为级验证：把 providerShortName 提出来在纯 JS 里跑
function extractFn(name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) throw new Error(`missing ${name}`)
  let depth = 0, j = src.indexOf('{', i)
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('unbalanced')
}

test('providerShortName 行为：真实分组名', () => {
  // t() 在浏览器里由 ctx.locale.bind 提供；测试里用 zh 词典等价 stub
  const dict = { 'model-origin.account': '账号', 'model-origin.api': 'API' }
  const t = (k) => dict[k] ?? k
  const fn = eval(`(${extractFn('providerShortName').replace(/^function\s*\(/, 'function (')})`)
  // DeepSeek 账号 → 账号（订阅分组）
  assert.equal(fn('DeepSeek 账号', 'deepseek-account'), '账号')
  // DeepSeek → API（直连分组）
  assert.equal(fn('DeepSeek', 'deepseek'), 'API')
  // Magpie 这类短名原样
  assert.equal(fn('Magpie', 'magpie'), 'Magpie')
  // 长名取首词
  assert.equal(fn('OpenAI Platform Org', 'openai'), 'OpenAI')
  // 超长首词截 8
  assert.equal(fn('VeryLongProviderName', 'x'), 'VeryLong')
  // 空名兜底 provider id
  assert.equal(fn('', 'abcdefghijk'), 'abcdefgh')
})
