import test from 'node:test'
import assert from 'node:assert/strict'
import { maskKey } from '../lib/index.js'

test('maskKey: 基本脱敏形态', () => {
	assert.equal(maskKey('mgk_live_jHY9M1zaIzcvE3kMo0vIc0eJbO7x8cV9'), 'mgk_li••••8cV9')
	assert.equal(maskKey('sk-8de9612a262245bdac00a825786d8710'), 'sk-8de••••8710')
})

test('maskKey: 较短但合规 key 脱敏', () => {
	assert.equal(maskKey('sk-1234567890'), 'sk-1••••7890')
})

test('maskKey: 超短 key 全部脱敏', () => {
	assert.equal(maskKey('12345678'), '••••••••')
	assert.equal(maskKey('short'), '••••••••')
})

test('maskKey: 空值与非法入参安全防护', () => {
	assert.equal(maskKey(''), null)
	assert.equal(maskKey('   '), null)
	assert.equal(maskKey(null), null)
	assert.equal(maskKey(undefined), null)
	assert.equal(maskKey(12345), null)
})
