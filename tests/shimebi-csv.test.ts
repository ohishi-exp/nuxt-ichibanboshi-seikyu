import { describe, it, expect } from 'vitest'
import { buildShimebiCsv, SHIMEBI_HINMOKU } from '../src/shimebi-csv'
import type { ShimebiCustomerRow } from '../src/shimebi-summary'

function row(over: Partial<ShimebiCustomerRow>): ShimebiCustomerRow {
  return {
    customerCode: '000001',
    customerName: '甲社',
    fareTotal: 10000,
    surchargeTotal: 500,
    actualTotal: 0,
    registered: true,
    diff: 500,
    warningCount: 0,
    ...over,
  }
}

describe('buildShimebiCsv', () => {
  it('ヘッダ + 行 (CRLF 区切り)、品名は既定', () => {
    const csv = buildShimebiCsv([row({})], '2026-07-31')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('得意先コード,取引先名,締め日,サーチャージ金額,品名,登録')
    expect(lines[1]).toBe(`000001,甲社,2026-07-31,500,${SHIMEBI_HINMOKU},登録済`)
  })

  it('サーチャージ 0 の取引先は出さない', () => {
    const csv = buildShimebiCsv(
      [row({ customerCode: 'A', surchargeTotal: 0 }), row({ customerCode: 'B', surchargeTotal: 300 })],
      '2026-07-31',
    )
    expect(csv).not.toContain('\nA,')
    expect(csv).toContain('B,')
    expect(csv.split('\r\n')).toHaveLength(2) // header + B のみ
  })

  it('カンマ/引用符を含む取引先名はエスケープ', () => {
    const csv = buildShimebiCsv([row({ customerName: 'A,B"社' })], '2026-07-31')
    expect(csv).toContain('"A,B""社"')
  })

  it('未登録は登録列が未登録', () => {
    const csv = buildShimebiCsv([row({ registered: false })], '2026-07-31')
    expect(csv).toContain(',未登録')
  })

  it('品名を上書きできる', () => {
    const csv = buildShimebiCsv([row({})], '2026-07-31', '燃料サーチャージ(7月)')
    expect(csv).toContain('燃料サーチャージ(7月)')
  })

  it('全行 0 ならヘッダのみ', () => {
    expect(buildShimebiCsv([row({ surchargeTotal: 0 })], '2026-07-31').split('\r\n')).toHaveLength(1)
  })
})
