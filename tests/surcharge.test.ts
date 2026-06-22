import { describe, it, expect } from 'vitest'
import {
  computeRowSurcharge,
  computeSurcharge,
  aggregate,
  type MeisaiRow,
  type SurchargeMasters,
} from '../src/surcharge'

// #12 の調査サンプル4行を再現するための合成マスタ。
// (実マスタは #1=燃費/対象得意先/基準価格, #2=軽油価格 で別途整備する)
//   価格差 = 当月軽油 130.0 − 基準 100.0 = 30.0
//   行1: 30 × 226km(長崎→福岡) ÷ 4.0(車種04) = 1695
const masters: SurchargeMasters = {
  basePrice: 100.0,
  monthlyDieselPrice: { '2026-06': 130.0 },
  fuelEfficiency: { '04': 4.0, '16': 3.0 }, // 車種00 は未登録 → 警告
  distanceKm: { ['長崎県\t福岡県']: 226 }, // 神奈川県 / 未マップ は未登録
}

// #12 コメントの検証出力（抜粋）に対応する4行
const sample: MeisaiRow[] = [
  // 計上: 30 × 226 ÷ 4 = 1695
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

  it('計上合計 = 1,695', () => {
    expect(summary.total).toBe(1695)
  })

  it('警告 2 件 (車種00 / 県未マップ)', () => {
    expect(summary.warnings).toHaveLength(2)
  })

  it('行1 = 1,695 で計上 (ok)', () => {
    expect(summary.results[0].status).toBe('ok')
    expect(summary.results[0].amount).toBe(1695)
    expect(summary.results[0].priceDiff).toBe(30)
    expect(summary.results[0].km).toBe(226)
    expect(summary.results[0].efficiency).toBe(4.0)
  })

  it('行2 = 同県 km=0 → 額0 (ok)', () => {
    expect(summary.results[1].status).toBe('ok')
    expect(summary.results[1].amount).toBe(0)
    expect(summary.results[1].km).toBe(0)
  })

  it('行3 = 車種00/距離未登録 → 警告 (未計上)', () => {
    expect(summary.results[2].status).toBe('warning')
    expect(summary.results[2].amount).toBe(0)
    expect(summary.results[2].warning).toBeDefined()
  })

  it('行4 = 県未マップ(?) → 距離未取得 警告', () => {
    expect(summary.results[3].status).toBe('warning')
    expect(summary.results[3].warning).toContain('距離未取得')
  })
})

describe('aggregate — 得意先C × 入金予定日', () => {
  it('ok 行のみを 得意先C×請求日 で分割集計する', () => {
    const { aggregates } = computeSurcharge(sample, masters)
    // ok は行1(田浦/07-31) と行2(島原/07-31) の 2 グループ
    expect(aggregates).toHaveLength(2)
    const tau = aggregates.find((a) => a.tokuiC === '000101')
    const sima = aggregates.find((a) => a.tokuiC === '000202')
    expect(tau?.amount).toBe(1695)
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
    expect(r.amount).toBe(1695)
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

  it('価格差マイナス → 0止め (ok, 額0)', () => {
    const m: SurchargeMasters = { ...masters, monthlyDieselPrice: { '2026-06': 90.0 } }
    const r = computeRowSurcharge(base, m)
    expect(r.status).toBe('ok')
    expect(r.priceDiff).toBe(0)
    expect(r.amount).toBe(0)
  })

  it('距離は対称: 逆順キーでも引ける', () => {
    const r = computeRowSurcharge({ ...base, fromPref: '福岡県', toPref: '長崎県' }, masters)
    expect(r.status).toBe('ok')
    expect(r.km).toBe(226)
    expect(r.amount).toBe(1695)
  })

  it('round: 端数は四捨五入', () => {
    // 価格差30 × 15km ÷ 4.0 = 112.5 → 113
    const m: SurchargeMasters = { ...masters, distanceKm: { ['長崎県\t福岡県']: 15 } }
    const r = computeRowSurcharge(base, m)
    expect(r.amount).toBe(113)
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
    expect(r.amount).toBe(1695)
  })
})
