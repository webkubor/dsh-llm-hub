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
 *   两条都是「约定没做成门禁」。本脚本把四条契约变成前置门:
 *     1. tarball 必含 paths in MUST_INCLUDE
 *     2. CHANGELOG 顶部必含 '## [<当前 package.json version>]' 段
 *     3. assets/ 目录里至少有一张 .svg 推广图 (不允许空目录占位)
 *     4. **运行期载荷必须与上一个已发布版本不同** —— 见下方「第 4 条」长注释
 *
 *   任一条挂了: process.exit(1) + stderr 一行指明错在哪。
 *
 *   `npm publish` 调用 prepublishOnly 时, 本脚本非零退出 → publish 整体
 *   失败, tarball 不会被推上 registry, 也就不会出现「npm 上了但本地行为
 *   与预期不一致」的漂移。
 */
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

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

// ── 4. 语义检查: 运行期载荷必须与上一个已发布版本不同 ────────────────────────
//
// 为什么需要这一条 (2026-09-26 的教训):
//   同一天里发了 1.5.0 / 1.5.1 / 1.5.2 / 1.5.3 四个版本号, 但
//   **用户能感知的变化只有 1.5.0 一个**:
//     · 1.5.1 修 package.json#files 漏配 assets  → tarball 少 3 张文档 SVG
//     · 1.5.2 加 prepublishOnly 脚本 + README 推广区 → 纯开发者流程
//     · 1.5.3 把门禁脚本塞进 tarball + 在 CHANGELOG 里承认之前错 → 纯元数据
//   三个版本号的「运行期载荷」(lib/ · types/ · cordis.patch.yml · package.json
//   的运行期字段) **逐字节相同**。semver 号是对用户的契约: 用户从 1.5.0 升到
//   1.5.3 期待行为有变化, 实际拿到的是同一份代码 —— 这是把流程修补包装成了
//   版本发布。
//
//   所以这里做机械判定, 不靠人自觉: 下载上一个已发布版本的 tarball, 比对
//   运行期载荷。完全相同 → 这版没有任何用户可感知的变化 → 拒绝。
//
//   为什么比对「运行期载荷」而不是「CHANGELOG 里有没有 feat/fix 关键字」:
//   关键字是启发式的, 自省段落里出现一个「修」字就会误放行 (1.5.3 的
//   CHANGELOG 里就写着「作者身份纠正(修 1.5.0/1.5.1/1.5.2)」)。
//   字节比对是确定的。
//
//   运行期载荷 = lib/ · types/ · cordis.patch.yml · package.json 的运行期字段
//   (name/type/main/types/exports/dsh/dependencies/peerDependencies/...)。
//   刻意排除 version / scripts / files / description / keywords / README /
//   assets / CHANGELOG —— 那些改了不算行为变化。
//
//   逃生舱: 确实需要发一个纯文档版本时, 设 ALLOW_METADATA_ONLY=1 显式放行,
//   脚本会打印警告。默认拒绝, 需要人主动越过。

const RUNTIME_DIRS = ['lib', 'types']
const RUNTIME_FILES = ['cordis.patch.yml']
/** package.json 里参与运行期语义的字段; 其余 (version/scripts/files/描述类) 不算。 */
const RUNTIME_PKG_FIELDS = [
  'name', 'type', 'main', 'types', 'exports', 'dsh',
  'dependencies', 'peerDependencies', 'optionalDependencies', 'engines'
]

/** 递归收集 dir 下所有文件的相对路径 → sha256。 */
function hashDir(root, dir) {
  const out = new Map()
  const walk = (rel) => {
    const abs = join(root, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs)) walk(join(rel, entry))
    } else {
      out.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir)
  return out
}

/** 运行期载荷指纹: 排序后的 "路径:哈希" 列表。 */
function runtimeFingerprint(root) {
  const entries = []
  for (const dir of RUNTIME_DIRS) {
    for (const [rel, hash] of hashDir(root, dir)) entries.push([rel, hash])
  }
  for (const file of RUNTIME_FILES) {
    try {
      entries.push([file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])
    } catch {
      // 缺文件本身由第 1 条契约负责报错, 这里不重复
    }
  }
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const runtimePkg = {}
    for (const field of RUNTIME_PKG_FIELDS) {
      if (manifest[field] !== undefined) runtimePkg[field] = manifest[field]
    }
    entries.push(['package.json(runtime)', createHash('sha256').update(JSON.stringify(runtimePkg)).digest('hex')])
  } catch {
    // 同上, package.json 读不了是别处的问题
  }
  return entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

if (process.env.ALLOW_METADATA_ONLY === '1') {
  console.warn('[prepublish-gate] ⚠️  ALLOW_METADATA_ONLY=1 —— 跳过第 4 条语义检查 (纯文档/元数据版本)')
} else {
  try {
    const versionsRaw = execFileSync('npm', ['view', pkg.name, 'versions', '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    })
    const published = JSON.parse(versionsRaw)
    const list = Array.isArray(published) ? published : [published]
    const previous = list.filter(v => v !== version).pop()

    if (previous === undefined) {
      console.log(`[prepublish-gate]   · 第 4 条: ${pkg.name} 尚无更早版本, 跳过载荷比对`)
    } else {
      const tarballUrl = execFileSync('npm', ['view', `${pkg.name}@${previous}`, 'dist.tarball'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      }).trim()

      const stage = mkdtempSync(join(tmpdir(), 'prepublish-gate-'))
      try {
        const tgz = join(stage, 'prev.tgz')
        const res = await fetch(tarballUrl)
        if (!res.ok) throw new Error(`下载 ${previous} tarball 失败: HTTP ${res.status}`)
        const { writeFileSync } = await import('node:fs')
        writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
        execFileSync('tar', ['-xzf', tgz, '-C', stage], { stdio: 'ignore' })

        const prevRoot = join(stage, 'package')
        const before = runtimeFingerprint(prevRoot)
        const after = runtimeFingerprint(pkgRoot)
        const same = JSON.stringify(before) === JSON.stringify(after)

        if (same) {
          const changedOnly = packFiles
            .filter(p => !p.startsWith('lib/') && !p.startsWith('types/') && !['cordis.patch.yml', 'package.json'].includes(p))
            .slice(0, 6)
          errors.push(
            `运行期载荷与上一个已发布版本 ${previous} **完全相同** —— 这个 semver 号没有承载任何用户可感知的变化\n` +
            `  → 本次只动了: ${changedOnly.join(', ') || '(仅 package.json 的非运行期字段)'}\n` +
            `  → semver 是对用户的契约: 流程修补 / 元数据修正 / 自省笔记不该占版本号。\n` +
            `     流程元数据类改动请不要发版 (改了 dev 仓即可); 确实要发纯文档版时显式设 ALLOW_METADATA_ONLY=1`
          )
        } else {
          console.log(`[prepublish-gate]   · 第 4 条: 运行期载荷相对 ${previous} 有变化 (${before.length} 项比对)`)
        }
      } finally {
        rmSync(stage, { recursive: true, force: true })
      }
    }
  } catch (err) {
    // 网络/registry 不可用时不阻断发版: 发版门禁不该因为一次查询失败而卡住
    // 真实发布。降级为警告, 把「这台机器没验成」说清楚。
    console.warn(`[prepublish-gate] ⚠️  第 4 条未能执行 (不阻断): ${err.message}`)
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

console.log(`[prepublish-gate] ✓ @${pkg.name}@${version} 四条契约通过`)
console.log(`[prepublish-gate]   · tarball: ${packFiles.length} 个文件, 含 ${assetSvgs.length} 张 assets/*.svg`)
console.log(`[prepublish-gate]   · CHANGELOG 含 '## [${version}]' 段`)