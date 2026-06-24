import { describe, it, expect } from 'vitest'
import {
  buildInputStaffRows,
  buildInputStaffCsv,
  listInputStaffCodes,
} from '../src/input-staff-detail'
import type { SurchargeResult, MeisaiRow } from '../src/surcharge'

function res(opts: {
  tokuiC: string
  name?: string
  staff?: string
  unchin?: number
  status?: SurchargeResult['status']
  amount?: number
  actual?: number
  saleDate?: string
  sub?: string
}): SurchargeResult {
  const row: MeisaiRow = {
    tokuiC: opts.tokuiC,
    tokuiName: opts.name ?? '甲社',
    fromPref: '東京都',
    toPref: '大阪府',
    sharuC: '01',
    uriageDate: opts.saleDate ?? '2026-05-10',
    unchin: opts.unchin ?? 1000,
    seikyuDate: '2026-06-30',
    subcontractorCode: opts.sub ?? '000000',
    vehicleNumber: '8504',
    vehicleName: '大型',
    actualSurcharge: opts.actual ?? 0,
    inputStaffCode: opts.staff,
  }
  return { row, status: opts.status ?? 'ok', amount: opts.amount ?? 0 }
}

describe('listInputStaffCodes', () => {
  it('入力担当C を昇順・重複排除・空欄除去で返す', () => {
    const codes = listInputStaffCodes([
      res({ tokuiC: 'A', staff: '0012' }),
      res({ tokuiC: 'B', staff: '0001' }),
      res({ tokuiC: 'C', staff: '0012' }),
      res({ tokuiC: 'D', staff: '' }),
      res({ tokuiC: 'E' }), // undefined
    ])
    expect(codes).toEqual(['0001', '0012'])
  })
})

describe('buildInputStaffRows', () => {
  it('入力者指定時はその入力担当C の明細のみ (登録/未登録問わず)', () => {
    const rows = buildInputStaffRows(
      [
        res({ tokuiC: 'A', staff: '0012', amount: 50 }),
        res({ tokuiC: 'B', staff: '0001', amount: 80 }),
      ],
      () => false, // 全て未登録
      '0012',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.inputStaffCode).toBe('0012')
    expect(rows[0]?.customerCode).toBe('A')
    expect(rows[0]?.computed).toBe(50)
  })

  it('入力者なし (空) は登録済み取引先の明細のみ・全入力者', () => {
    const rows = buildInputStaffRows(
      [
        res({ tokuiC: 'A', staff: '0012' }),
        res({ tokuiC: 'B', staff: '0001' }),
      ],
      (c) => c === 'A', // A だけ登録済み
      '',
    )
    expect(rows.map((r) => r.customerCode)).toEqual(['A'])
    expect(rows[0]?.registered).toBe(true)
  })

  it('差額 = 計算 − 実額、warning/excluded は計算 0', () => {
    const rows = buildInputStaffRows(
      [
        res({ tokuiC: 'A', staff: '0012', status: 'ok', amount: 120, actual: 100 }),
        res({ tokuiC: 'A', staff: '0012', status: 'warning', amount: 0, actual: 30 }),
      ],
      () => true,
      '0012',
    )
    expect(rows[0]?.computed).toBe(120)
    expect(rows[0]?.actual).toBe(100)
    expect(rows[0]?.diff).toBe(20)
    expect(rows[1]?.computed).toBe(0)
    expect(rows[1]?.diff).toBe(-30)
  })

  it('並び順は 入力者 → 売上年月日 → 取引先コード', () => {
    const rows = buildInputStaffRows(
      [
        res({ tokuiC: 'B', staff: '0012', saleDate: '2026-05-20' }),
        res({ tokuiC: 'A', staff: '0012', saleDate: '2026-05-10' }),
        res({ tokuiC: 'A', staff: '0001', saleDate: '2026-05-31' }),
      ],
      () => true,
      '',
    )
    expect(rows.map((r) => [r.inputStaffCode, r.saleDate, r.customerCode])).toEqual([
      ['0001', '2026-05-31', 'A'],
      ['0012', '2026-05-10', 'A'],
      ['0012', '2026-05-20', 'B'],
    ])
  })

  it('傭車先C で自車/傭車区分を出す', () => {
    const rows = buildInputStaffRows(
      [res({ tokuiC: 'A', staff: '0012', sub: '001234' })],
      () => true,
      '0012',
    )
    expect(rows[0]?.ownership).toBe('傭車')
  })
})

describe('buildInputStaffCsv', () => {
  it('ヘッダ + 行を CSV 化し、カンマ/引用符はエスケープ', () => {
    const rows = buildInputStaffRows(
      [res({ tokuiC: 'A001', name: '甲, 社', staff: '0012', amount: 50, actual: 30 })],
      () => true,
      '0012',
    )
    const csv = buildInputStaffCsv(rows)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      '入力者,売上年月日,請求日,取引先コード,取引先名,車番,車種,積地県,卸地県,自車傭車,運賃,計算サーチャージ,実額(割増C19),差額,登録',
    )
    expect(lines[1]).toContain('"甲, 社"') // カンマを含む取引先名は quote
    expect(lines[1]).toContain('0012')
    expect(lines[1]).toContain('登録済')
  })

  it('空行は header のみ', () => {
    expect(buildInputStaffCsv([])).toBe(
      '入力者,売上年月日,請求日,取引先コード,取引先名,車番,車種,積地県,卸地県,自車傭車,運賃,計算サーチャージ,実額(割増C19),差額,登録',
    )
  })
})
