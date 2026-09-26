#!/usr/bin/env node
/**
 * prepublish-gate —— 在 `npm publish` 之前把三条硬契约拦在本地。
 *
 * 为什么是门禁而不是文档:
 *   2026-09-26 推 1.5.0 时, CHANGELOG 写了、assets/ 落了、版本号 bump 了,
 *   但 package.json 的 files 数组忘了加 'assets' —— 推上 npm 后 122kB
 *   tarball 不含 3 张 SVG, 从 npm 读 CHANGELOG.md 的人看不到截图。
 *   同样那次, 1.5.1 推上去时 publish.yml 在「GH Release」那一步挂了:
 *   CHANGELOG 里没 [1.5.1] 段, 脚本 process.exit(1), 整个 job 标红。
 *   npm publish 已经过 —— 1.5.1 在 npm 上, 但 GH Release 没建, 走到 README
 *   想挂 release link 时发现 404。
 *
 *   两条都是「约定没做成门禁」。本脚本把三条契约变成前置门:
 *     1. tarball 必含 paths in MUST_INCLUDE
 *     2. CHANGELOG 顶部必含 '## [<当前 package.json version>]' 段
 *     3. assets/ 目录里至少有一张 .svg 推广图 (不允许空目录占位)
 *
 *   任一条挂了: process.exit(1) + stderr 一行指明错在哪。
 *
 *   `npm publish` 调用 prepublishOnly 时, 本脚本非零退出 → publish 整体
 *   失败, tarball 不会被推上 registry, 也就不会出现「npm 上了但本地行为
 *   与预期不一致」的漂移。
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = dirname(here)

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
const version = pkg.version

const MUST_INCLUDE = [
  'package.json',
  'cordis.patch.yml',
  'lib/client.js',
  'lib/index.js',
  'lib/harness.js',
  'README.md',
  'LICENSE'
]

const ASSETS_MIN = 1 // 至少一张 .svg, 防止目录被空提交

const errors = []

// ── 1. tarball 路径断言 ────────────────────────────────────────────────────
let packFiles
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  packFiles = JSON.parse(out)[0].files.map(f => f.path)
} catch (err) {
  console.error('[prepublish-gate] npm pack --dry-run 失败:', err.message)
  process.exit(2)
}

const missing = MUST_INCLUDE.filter(p => !packFiles.includes(p))
if (missing.length > 0) {
  errors.push(`tarball 缺少必含文件: ${missing.join(', ')}\n  → 在 package.json 'files' 数组里列出, 或确认文件实际存在`)
}

// ── 2. assets/ 目录必含至少一张 SVG ─────────────────────────────────────────
const assetSvgs = packFiles.filter(p => p.startsWith('assets/') && p.endsWith('.svg'))
if (assetSvgs.length < ASSETS_MIN) {
  errors.push(`tarball assets/ 里 .svg < ${ASSETS_MIN}: 找到 ${assetSvgs.length} 张\n  → 在 assets/ 下放图, 并确认 package.json 'files' 含 'assets'`)
}

// ── 3. CHANGELOG 顶部必含 '## [<当前 version>]' 段 ─────────────────────────
const changelogPath = join(pkgRoot, 'CHANGELOG.md')
let changelogText
try {
  changelogText = readFileSync(changelogPath, 'utf8')
} catch (err) {
  errors.push(`CHANGELOG.md 读取失败: ${err.message}`)
  changelogText = ''
}

if (changelogText) {
  const expectedHeader = `## [${version}]`
  if (!changelogText.includes(expectedHeader)) {
    errors.push(`CHANGELOG.md 缺少 '${expectedHeader}' 段\n  → publish.yml 的 release body 直接 grep 这一行; 缺了 GH Release 创建会失败, npm 上却有版本号, 出现「npm 上了 / Release 没建」的漂移`)
  }
}

// ── 报告 ──────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error(`\n[prepublish-gate] ${errors.length} 条契约不满足, 拒绝发版:\n`)
  for (const e of errors) {
    console.error('  ✖', e)
    console.error('')
  }
  console.error('[prepublish-gate] exit 1 → npm publish 已中止。修完再推。')
  process.exit(1)
}

console.log(`[prepublish-gate] ✓ @${pkg.name}@${version} 三条契约通过`)
console.log(`[prepublish-gate]   · tarball: ${packFiles.length} 个文件, 含 ${assetSvgs.length} 张 assets/*.svg`)
console.log(`[prepublish-gate]   · CHANGELOG 含 '## [${version}]' 段`)