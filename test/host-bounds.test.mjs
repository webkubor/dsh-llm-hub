/**
 * 保护性边界测试。
 *
 * 2026-09-17 补。此前 53 条测试覆盖的全是**业务分支**（状态码映射、安装组合、
 * 配置回填），质量很高 —— 但变异测试发现：把响应体上限、请求超时、缓存 TTL、
 * 卡死判定这四个常量全部改成「无限大」，53 条一条都不失败。
 *
 * 这些常量守的是宿主本身的命：DSH 是常驻进程，一次内存打爆或一次永久挂死
 * 就够把整个会话拖垮。它们不报错、不出现在任何业务分支里，正因如此最需要被钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readBounded, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS,
  AVAILABILITY_TTL_MS, STUCK_PROBE_MS,
} from '../lib/index.js'

/** 造一个流式响应；declaredLength 用于模拟「服务器声明的 content-length」。 */
function makeResponse(bytes, { declaredLength, chunkSize = 64 * 1024 } = {}) {
  const headers = new Map()
  if (declaredLength !== undefined) headers.set('content-length', String(declaredLength))
  let sent = 0
  let cancelled = false
  const body = {
    cancelled: () => cancelled,
    cancel: async () => { cancelled = true },
    getReader() {
      return {
        read: async () => {
          if (sent >= bytes) return { done: true, value: undefined }
          const n = Math.min(chunkSize, bytes - sent)
          sent += n
          return { done: false, value: new Uint8Array(n) }
        },
        cancel: async () => { cancelled = true },
        releaseLock: () => {},
      }
    },
  }
  return { headers: { get: (k) => headers.get(k) ?? null }, body, _cancelled: () => cancelled }
}

test('四个边界常量是有限正数 —— 被改成无限大就等于没护栏', () => {
  for (const [n, v] of Object.entries({
    MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, AVAILABILITY_TTL_MS, STUCK_PROBE_MS,
  })) {
    assert.ok(Number.isFinite(v), `${n} 必须有限`)
    assert.ok(v > 0, `${n} 必须为正`)
    assert.ok(v < Number.MAX_SAFE_INTEGER, `${n} 不能是「实际上不限制」`)
  }
})

test('各边界取值在合理量级 —— 防止调成天文数字绕过限制', () => {
  assert.ok(MAX_RESPONSE_BYTES <= 64 * 1024 * 1024, '响应体上限超过 64MB 就失去保护意义')
  assert.ok(REQUEST_TIMEOUT_MS <= 60_000, '单次外部请求超时不该超过 1 分钟，UI 会一直转圈')
  assert.ok(AVAILABILITY_TTL_MS <= 60 * 60 * 1000, '可用性缓存超过 1 小时，key 换了还在报旧状态')
  assert.ok(STUCK_PROBE_MS <= 10 * 60 * 1000, '卡死判定超过 10 分钟，一次卡死会长期占住槽位')
})

test('readBounded：正常大小的响应完整读出', async () => {
  const res = makeResponse(1024)
  const out = await readBounded(res, 'https://example.com/models')
  assert.equal(out.length, 1024)
})

test('readBounded：声明长度超限 → 立刻拒绝且取消流（不浪费带宽）', async () => {
  const res = makeResponse(1024, { declaredLength: MAX_RESPONSE_BYTES + 1 })
  await assert.rejects(
    () => readBounded(res, 'https://evil.example/models'),
    /more than \d+ bytes/,
  )
  assert.ok(res._cancelled(), '声明就超限时必须 cancel body，否则对端会继续发')
})

test('readBounded：声明长度撒谎（未声明但实际超限）→ 累计字节兜住', async () => {
  // 真正生效的防线是累计计数 —— 不诚实的服务器不会给 content-length
  const res = makeResponse(MAX_RESPONSE_BYTES + 128 * 1024)
  await assert.rejects(
    () => readBounded(res, 'https://liar.example/models'),
    /more than \d+ bytes/,
  )
  assert.ok(res._cancelled(), '超限时必须 cancel reader，否则流继续消耗内存')
})

test('readBounded：空 body 返回空串，不抛', async () => {
  assert.equal(await readBounded({ headers: { get: () => null }, body: null }, 'u'), '')
  assert.equal(await readBounded({ headers: { get: () => null }, body: undefined }, 'u'), '')
})

test('readBounded：content-length 非数字不影响读取（不能因为头脏就失败）', async () => {
  const res = makeResponse(512, { declaredLength: 'not-a-number' })
  assert.equal((await readBounded(res, 'u')).length, 512)
})

test('readBounded：恰好等于上限放行，超一字节拒绝（边界不能差一）', async () => {
  assert.equal((await readBounded(makeResponse(MAX_RESPONSE_BYTES), 'u')).length, MAX_RESPONSE_BYTES)
  await assert.rejects(() => readBounded(makeResponse(MAX_RESPONSE_BYTES + 1), 'u'), /more than/)
})
