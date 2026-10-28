/**
 * 守卫：README 里不能出现本包的旧包名。
 *
 * 2026-09-17 owner 指出「你的 SOP 少环节导致每次老是留尾巴」——
 * 那天连发多个版本，README 里的 @webkubor/... 没跟着改到 @dsh-plugins/...，
 * 而 npm 包页展示的就是 README，用户第一眼看到的是错的安装命令。
 *
 * 只比对「同名不同 scope」的情况，不做全文校验 —— 宁可漏报不可误报，
 * 误报会让人把整条守卫关掉。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const bare = pkg.name.includes('/') ? pkg.name.split('/')[1] : pkg.name

for (const f of ['README.md', 'README.en.md']) {
  const url = new URL(`../${f}`, import.meta.url)
  if (!existsSync(url)) continue
  test(`${f} 里没有本包的旧包名`, () => {
    const text = readFileSync(url, 'utf8')
    // CHANGELOG 式的历史叙述不在 README 里，README 出现的都该是当前名
    //
    // 2026-10-28 修一处误报：正则 `/@[\w-]+\/[\w.-]+/g` 会把 jsDelivr 的
    // CDN 图片地址（`cdn.jsdelivr.net/gh/webkubor/free-imgbed@main/dsh-llm-hub/xx.svg`）
    // 里的 `@main/dsh-llm-hub` 当成旧 scope 包名 —— 这里的 `@main` 是 git ref
    // （分支名），后面跟的是**仓库内路径**，不是 npm 包名。
    // 判据：只有当 @ 之后那段**确实像一个 npm scope**（与当前包名的 scope 同形）
    // 才算包名候选。已知的 git ref（main/master/develop/…）直接排除。
    const GIT_REFS = new Set(['main', 'master', 'develop', 'dev', 'HEAD', 'next', 'release'])
    const scoped = [...new Set(text.match(/@[\w-]+\/[\w.-]+/g) || [])]
      .filter((n) => !GIT_REFS.has(n.slice(1).split('/')[0]))
    const stale = scoped.filter((n) => n.split('/')[1] === bare && n !== pkg.name)
    assert.deepEqual(
      stale, [],
      `${f} 里还写着旧包名 ${stale.join(', ')}，当前是 ${pkg.name}。` +
      'npm 包页展示的就是 README，用户会照着错的安装命令敲。',
    )
  })
}
