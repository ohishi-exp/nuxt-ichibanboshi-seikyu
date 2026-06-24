import { describe, it, expect } from 'vitest'
import {
  mapToMeisaiRows,
  ownershipLabel,
  reconcileRow,
  type IchibanSurchargeRow,
} from '../src/surcharge-review'
import type { SurchargeResult } from '../src/surcharge'
import { computeSurcharge, type SurchargeMasters } from '../src/surcharge'
import { toEfficiencyLookup, parseFuelEfficiencyCsv } from '../src/fuel-efficiency'
import { toMonthlyPriceMap, parseDieselPriceCsv } from '../src/diesel-price'
import { distanceKey } from '../src/distance'

const ROWS: IchibanSurchargeRow[] = [
  {
    request_kind: '1',
    customer_code: '000101',
    customer_name: '㈱田浦畜産',
    origin_prefecture: '長崎県',
    dest_prefecture: '福岡県',
    vehicle_code: '04',
    vehicle_name: '大型幌',
    sale_date: '2026-06-21',
    fare: 65000,
    billing_date: '2026-07-31',
  },
  {
    request_kind: '1',
    customer_code: '000404',
    customer_name: '㈱谷川商事',
    origin_prefecture: '?',
    dest_prefecture: '?',
    vehicle_code: '16',
    vehicle_name: '8ｔﾕﾆｯｸ',
    sale_date: '2026-06-20',
    fare: 840000,
    billing_date: null,
  },
]

describe('mapToMeisaiRows', () => {
  it('field 名を MeisaiRow に写像する', () => {
    const m = mapToMeisaiRows(ROWS)
    expect(m[0]).toEqual({
      tokuiC: '000101',
      tokuiName: '㈱田浦畜産',
      fromPref: '長崎県',
      toPref: '福岡県',
      sharuC: '04',
      vehicleName: '大型幌',
      uriageDate: '2026-06-21',
      unchin: 65000,
      seikyuDate: '2026-07-31',
      actualSurcharge: 0,
    })
  })

  it('fuel_surcharge (割増C=19 実額) を actualSurcharge に写像、欠落は 0', () => {
    const rows: IchibanSurchargeRow[] = [{ ...ROWS[0]!, fuel_surcharge: 4020 }]
    expect(mapToMeisaiRows(rows)[0]?.actualSurcharge).toBe(4020)
    expect(mapToMeisaiRows(ROWS)[1]?.actualSurcharge).toBe(0) // 欠落 → 0
  })

  it('row_id (管理年月日+管理C) を rowId に写像、欠落は undefined', () => {
    const rows: IchibanSurchargeRow[] = [{ ...ROWS[0]!, row_id: '20260621-1001' }]
    expect(mapToMeisaiRows(rows)[0]?.rowId).toBe('20260621-1001')
    expect(mapToMeisaiRows(ROWS)[1]?.rowId).toBeUndefined() // 欠落 → undefined (skip 不可)
  })

  it('請求日 null は空文字に正規化', () => {
    expect(mapToMeisaiRows(ROWS)[1]?.seikyuDate).toBe('')
  })

  it('空配列', () => {
    expect(mapToMeisaiRows([])).toEqual([])
  })

  it('傭車先C (subcontractor_code) を subcontractorCode に写像', () => {
    const rows: IchibanSurchargeRow[] = [{ ...ROWS[0]!, subcontractor_code: '001234' }]
    expect(mapToMeisaiRows(rows)[0]?.subcontractorCode).toBe('001234')
  })
})

describe('ownershipLabel (自車/傭車)', () => {
  it("'000000' は自車", () => {
    expect(ownershipLabel('000000')).toBe('自車')
  })
  it('それ以外のコードは傭車', () => {
    expect(ownershipLabel('001234')).toBe('傭車')
  })
  it('空 / undefined (producer 旧版) は —', () => {
    expect(ownershipLabel('')).toBe('—')
    expect(ownershipLabel(undefined)).toBe('—')
  })
})

describe('reconcileRow (計算 vs 実額 割増C=19)', () => {
  const base = mapToMeisaiRows(ROWS)[0]!
  const mk = (
    status: SurchargeResult['status'],
    amount: number,
    actual: number,
  ): SurchargeResult => ({ row: { ...base, actualSurcharge: actual }, status, amount })

  it('一致: 計算 === 実額 → diff 0 / match true', () => {
    expect(reconcileRow(mk('ok', 4020, 4020))).toEqual({
      computed: 4020,
      actual: 4020,
      diff: 0,
      match: true,
    })
  })
  it('未計上: 計算 > 実額 → diff 正 / match false', () => {
    expect(reconcileRow(mk('ok', 5000, 4020))).toEqual({
      computed: 5000,
      actual: 4020,
      diff: 980,
      match: false,
    })
  })
  it('過計上: 計算 < 実額 → diff 負', () => {
    expect(reconcileRow(mk('ok', 3000, 4020)).diff).toBe(-1020)
  })
  it('status!==ok は computed 0 (warning/excluded は計算なし扱い)', () => {
    expect(reconcileRow(mk('warning', 1000, 0)).computed).toBe(0)
    expect(reconcileRow(mk('excluded', 1000, 0)).computed).toBe(0)
  })
})

describe('一番星行 → 計算エンジン end-to-end', () => {
  it('全マスタを流し込んで集計できる', () => {
    const fuel = parseFuelEfficiencyCsv(
      '車種C,車種名,燃費,有効開始,有効終了\n04,大型幌,4.0,2026-01-01,\n',
    ).entries
    const diesel = parseDieselPriceCsv('年月,軽油価格\n2026-06,130\n').entries
    const masters: SurchargeMasters = {
      basePrice: 100,
      priceStep: 5,
      monthlyDieselPrice: toMonthlyPriceMap(diesel),
      fuelEfficiency: toEfficiencyLookup(fuel),
      distanceKm: { [distanceKey('長崎県', '福岡県')]: 155 },
    }
    const { results, total, warnings } = computeSurcharge(mapToMeisaiRows(ROWS), masters)
    // 行1: 上昇額27.5 (130→区間(125,130]) × 155 ÷ 4 = ceil(1065.625) = 1066
    expect(results[0]?.status).toBe('ok')
    expect(results[0]?.amount).toBe(1066)
    expect(total).toBe(1066)
    // 行2: 県未マップ(?) → 距離未取得 警告
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.warning).toContain('距離未取得')
  })
})
