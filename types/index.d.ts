/**
 * @dsh-plugins/dsh-llm-hub TypeScript Definitions
 */

export const name: 'dsh-llm-hub'
export const inject: string[]

export const MAX_RESPONSE_BYTES: number
export const AVAILABILITY_TTL_MS: number
export const STUCK_PROBE_MS: number
export const REQUEST_TIMEOUT_MS: number

export interface UsageRecord {
	id: string
	provider: string
	model: string
	month: string
	tokensIn: number
	tokensOut: number
	tokensTotal: number
	costUsd: number
	calls: number
	updatedAt: number
}

export const UsageRecordSchema: {
	readonly id: 'string'
	readonly provider: 'string'
	readonly model: 'string'
	readonly month: 'string'
	readonly tokensIn: 'number'
	readonly tokensOut: 'number'
	readonly tokensTotal: 'number'
	readonly costUsd: 'number'
	readonly calls: 'number'
	readonly updatedAt: 'number'
}

export function normalizeUsageForTest(usage: any): {
	tokensIn: number
	tokensOut: number
	tokensTotal: number
}

export function recordUsageInto(table: any, entry: any): void
export function readBounded(response: any, url: string): Promise<string>
export function maskKey(key: string | null | undefined): string

export interface RotatedEnvResult {
	ref: string
	index: number
	total: number
}

export function pickRotatedEnv(
	refs: string | string[] | undefined,
	provider: string,
	stateMap?: Map<string, number>
): RotatedEnvResult | undefined

export function apply(ctx: any): void

