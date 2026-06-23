import { describe, it, expect } from 'vitest'
import { mapToMeisaiRows, type IchibanSurchargeRow } from '../src/surcharge-review'
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
      uriageDate: '2026-06-21',
      unchin: 65000,
      seikyuDate: '2026-07-31',
    })
  })

  it('請求日 null は空文字に正規化', () => {
    expect(mapToMeisaiRows(ROWS)[1]?.seikyuDate).toBe('')
  })

  it('空配列', () => {
    expect(mapToMeisaiRows([])).toEqual([])
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
