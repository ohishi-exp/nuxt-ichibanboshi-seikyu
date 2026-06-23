import { describe, it, expect } from 'vitest'
import {
  computeRowSurcharge,
  computeSurcharge,
  aggregate,
  surchargeIncrement,
  type MeisaiRow,
  type SurchargeMasters,
} from '../src/surcharge'

// #12 の調査サンプル4行を再現するための合成マスタ。
// (実マスタは #1=燃費/対象得意先/基準価格, #2=軽油価格 で別途整備する)
//   段階テーブル (#11-C): 当月軽油 130.0 は区間 (125,130] → 上昇額 27.5
//   行1: ceil(27.5 × 226km(長崎→福岡) ÷ 4.0(車種04)) = ceil(1553.75) = 1554
const masters: SurchargeMasters = {
  basePrice: 100.0,
  monthlyDieselPrice: { '2026-06': 130.0 },
  fuelEfficiency: { '04': 4.0, '16': 3.0 }, // 車種00 は未登録 → 警告
  distanceKm: { ['長崎県\t福岡県']: 226 }, // 神奈川県 / 未マップ は未登録
}

// #12 コメントの検証出力（抜粋）に対応する4行
const sample: MeisaiRow[] = [
  // 計上: ceil(27.5 × 226 ÷ 4) = 1554
  { tokuiC: '000101', tokuiName: '㈱田浦畜産', fromPref: '長崎県', toPref: '福岡県', sharuC: '04', uriageDate: '2026-06-21', unchin: 65000, seikyuDate: '2026-07-31' },
  // 同県 km=0 → 額0 (ok, 警告ではない)
  { tokuiC: '000202', tokuiName: '島原雲仙農協 本店', fromPref: '長崎県', toPref: '長崎県', sharuC: '04', uriageDate: '2026-06-21', unchin: 8000, seikyuDate: '2026-07-31' },
  // 車種00 未設定 かつ 距離未登録 → 警告
  { tokuiC: '000303', tokuiName: '西部運輸㈱ 福岡営業所', fromPref: '長崎県', toPref: '神奈川県', sharuC: '00', uriageDate: '2026-06-19', unchin: 145000, seikyuDate: '2026-08-15' },
  // 地域C=000000 未マップ (?→?) → 警告
  { tokuiC: '000404', tokuiName: '㈱谷川商事', fromPref: '?', toPref: '?', sharuC: '16', uriageDate: '2026-06-20', unchin: 840000, seikyuDate: '2026-07-10' },
]

describe('computeSurcharge — #4 受入条件 (サンプル4行)', () => {
  const summary = computeSurcharge(sample, masters)
  // noUncheckedIndexedAccess 配下では results[i] が T | undefined になる。
  // サンプル 4 行は必ず存在するので非 null 表明で受ける。
  const r0 = summary.results[0]!
  const r1 = summary.results[1]!
  const r2 = summary.results[2]!
  const r3 = summary.results[3]!

  it('計上合計 = 1,554', () => {
    expect(summary.total).toBe(1554)
  })

  it('警告 2 件 (車種00 / 県未マップ)', () => {
    expect(summary.warnings).toHaveLength(2)
  })

  it('行1 = 1,554 で計上 (ok)', () => {
    expect(r0.status).toBe('ok')
    expect(r0.amount).toBe(1554)
    expect(r0.increment).toBe(27.5)
    expect(r0.km).toBe(226)
    expect(r0.efficiency).toBe(4.0)
  })

  it('行2 = 同県 km=0 → 額0 (ok)', () => {
    expect(r1.status).toBe('ok')
    expect(r1.amount).toBe(0)
    expect(r1.km).toBe(0)
  })

  it('行3 = 車種00/距離未登録 → 警告 (未計上)', () => {
    expect(r2.status).toBe('warning')
    expect(r2.amount).toBe(0)
    expect(r2.warning).toBeDefined()
  })

  it('行4 = 県未マップ(?) → 距離未取得 警告', () => {
    expect(r3.status).toBe('warning')
    expect(r3.warning).toContain('距離未取得')
  })
})

describe('aggregate — 得意先C × 入金予定日', () => {
  it('ok 行のみを 得意先C×請求日 で分割集計する', () => {
    const { aggregates } = computeSurcharge(sample, masters)
    // ok は行1(田浦/07-31) と行2(島原/07-31) の 2 グループ
    expect(aggregates).toHaveLength(2)
    const tau = aggregates.find((a) => a.tokuiC === '000101')
    const sima = aggregates.find((a) => a.tokuiC === '000202')
    expect(tau?.amount).toBe(1554)
    expect(tau?.count).toBe(1)
    expect(sima?.amount).toBe(0)
  })

  it('多締: 同一得意先でも入金予定日が違えば別グループに分割', () => {
    const rows: MeisaiRow[] = [
      { tokuiC: '000999', fromPref: '長崎県', toPref: '福岡県', sharuC: '04', uriageDate: '2026-06-01', unchin: 0, seikyuDate: '2026-07-20' },
      { tokuiC: '000999', fromPref: '長崎県', toPref: '福岡県', sharuC: '04', uriageDate: '2026-06-15', unchin: 0, seikyuDate: '2026-07-31' },
    ]
    const aggs = aggregate(rows.map((r) => computeRowSurcharge(r, masters)))
    expect(aggs).toHaveLength(2)
    expect(aggs.map((a) => a.seikyuDate)).toEqual(['2026-07-20', '2026-07-31'])
  })
})

describe('computeRowSurcharge — エッジ / 分岐', () => {
  const base: MeisaiRow = {
    tokuiC: '000101', fromPref: '長崎県', toPref: '福岡県', sharuC: '04',
    uriageDate: '2026-06-21', unchin: 65000, seikyuDate: '2026-07-31',
  }

  it('運賃0 でも計算式に影響しない (運賃は使わない)', () => {
    const r = computeRowSurcharge({ ...base, unchin: 0 }, masters)
    expect(r.status).toBe('ok')
    expect(r.amount).toBe(1554)
  })

  it('当月価格なし → 警告', () => {
    const r = computeRowSurcharge({ ...base, uriageDate: '2026-05-10' }, masters)
    expect(r.status).toBe('warning')
    expect(r.warning).toContain('当月価格なし')
  })

  it('燃費 0 以下 → 警告', () => {
    const m: SurchargeMasters = { ...masters, fuelEfficiency: { '04': 0 } }
    const r = computeRowSurcharge(base, m)
    expect(r.status).toBe('warning')
    expect(r.warning).toContain('燃費未定義')
  })

  it('基準価格以下 → 廃止扱いで上昇額0 (ok, 額0)', () => {
    const m: SurchargeMasters = { ...masters, monthlyDieselPrice: { '2026-06': 90.0 } }
    const r = computeRowSurcharge(base, m)
    expect(r.status).toBe('ok')
    expect(r.increment).toBe(0)
    expect(r.amount).toBe(0)
  })

  it('距離は対称: 逆順キーでも引ける', () => {
    const r = computeRowSurcharge({ ...base, fromPref: '福岡県', toPref: '長崎県' }, masters)
    expect(r.status).toBe('ok')
    expect(r.km).toBe(226)
    expect(r.amount).toBe(1554)
  })

  it('ceil: 端数は円単位切り上げ', () => {
    // 上昇額27.5 × 15km ÷ 4.0 = 103.125 → ceil 104
    const m: SurchargeMasters = { ...masters, distanceKm: { ['長崎県\t福岡県']: 15 } }
    const r = computeRowSurcharge(base, m)
    expect(r.amount).toBe(104)
  })

  it('priceStep を上書きすると段階幅が変わる', () => {
    // step=10, base=100, monthly=130 → 区間 (120,130] → 上昇額 10·2 + 5 = 25
    const m: SurchargeMasters = { ...masters, priceStep: 10 }
    const r = computeRowSurcharge(base, m)
    expect(r.increment).toBe(25)
    expect(r.amount).toBe(Math.ceil((25 * 226) / 4)) // = 1413
  })

  it('対象外得意先 → excluded (計算しない)', () => {
    const m: SurchargeMasters = { ...masters, isTargetCustomer: (c) => c === '000202' }
    const r = computeRowSurcharge(base, m)
    expect(r.status).toBe('excluded')
    expect(r.amount).toBe(0)
  })

  it('対象得意先は通常計算される', () => {
    const m: SurchargeMasters = { ...masters, isTargetCustomer: (c) => c === '000101' }
    const r = computeRowSurcharge(base, m)
    expect(r.status).toBe('ok')
    expect(r.amount).toBe(1554)
  })
})

describe('surchargeIncrement — 段階テーブル (届出書方式)', () => {
  it('基準価格以下は 0 (廃止)', () => {
    expect(surchargeIncrement(100, 100)).toBe(0)
    expect(surchargeIncrement(95, 100)).toBe(0)
  })

  it('区間 (100,105] → 2.5 (上限含む)', () => {
    expect(surchargeIncrement(100.01, 100)).toBe(2.5)
    expect(surchargeIncrement(102.5, 100)).toBe(2.5)
    expect(surchargeIncrement(105, 100)).toBe(2.5)
  })

  it('区間 (105,110] → 7.5', () => {
    expect(surchargeIncrement(105.01, 100)).toBe(7.5)
    expect(surchargeIncrement(110, 100)).toBe(7.5)
  })

  it('区間 (125,130] → 27.5', () => {
    expect(surchargeIncrement(130, 100)).toBe(27.5)
  })

  it('区間 (180,185] → 82.5', () => {
    expect(surchargeIncrement(185, 100)).toBe(82.5)
  })

  it('step を変えると刻みが変わる', () => {
    expect(surchargeIncrement(130, 100, 10)).toBe(25) // (120,130] → 10·2+5
  })

  it('step <= 0 は 0 (防御)', () => {
    expect(surchargeIncrement(130, 100, 0)).toBe(0)
  })
})
