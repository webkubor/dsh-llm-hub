/**
 * 注册 id 必须等于 package.json 的 name。
 *
 * 2026-09-17 踩到：包名迁到 @webkubor/ scope 时（commit f907589）package.json 改了、
 * lib/client.js 里的 `id:` 漏了。宿主按 name 找注册，对不上就报
 *   "loaded without registering @dsh-plugins/dsh-llm-hub via __ModuleLoader__.load"
 *
 * 为什么必须有断言兜着：DSH 把所有插件打进**同一个 client bundle**，一个注册失败
 * 整个 bundle 一起废 —— 用户看到的是「Failed to load plugins」和一长串包名，
 * 完全看不出是哪个插件的锅。而这个错既不影响构建、也不影响 lint，
 * 只有真的把插件装进 DSH 并打开才会暴露。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')

test('client.js 注册的 id 等于 package.json 的 name', () => {
  const m = client.match(/__ModuleLoader__\.load\(\{[\s\S]{0,800}?\bid:\s*['"]([^'"]+)['"]/)
  assert.ok(m, '没找到 __ModuleLoader__.load({ id: ... }) —— 注册块被改动过就来核对这条')
  assert.equal(
    m[1], pkg.name,
    `注册 id 与包名不符：id='${m[1]}' 而 name='${pkg.name}'。` +
    '宿主按 name 找注册，对不上会让整个 client bundle 一起加载失败。',
  )
})

test('产物里不能出现顶层 import/export —— 宿主是 factory(require) 形态', () => {
  const bad = client.split('\n').filter((l) => /^\s*(import|export)\s/.test(l))
  assert.deepEqual(bad, [], `顶层 import/export 会让 bundle 解析失败：\n${bad.join('\n')}`)
})
