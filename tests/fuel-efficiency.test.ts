import { describe, it, expect } from 'vitest'
import {
  parseFuelEfficiencyCsv,
  serializeFuelEfficiencyCsv,
  resolveFuelEfficiency,
  toEfficiencyLookup,
  type FuelEfficiencyEntry,
} from '../src/fuel-efficiency'
import { computeRowSurcharge, type SurchargeMasters, type MeisaiRow } from '../src/surcharge'

const SAMPLE_CSV =
  '車種C,車種名,燃費,有効開始,有効終了\n' +
  '04,大型車,3.5,2026-01-01,\n' +
  '16,トレーラー,3.0,2026-01-01,2026-03-31\n' +
  '16,トレーラー,3.2,2026-04-01,\n'

describe('parseFuelEfficiencyCsv', () => {
  it('ヘッダ + 3 行を取り込む', () => {
    const { entries, warnings } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    expect(warnings).toEqual([])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual<FuelEfficiencyEntry>({
      sharuC: '04',
      name: '大型車',
      kmPerL: 3.5,
      validFrom: '2026-01-01',
    })
    // 有効終了ありは validTo 付き
    expect(entries[1]?.validTo).toBe('2026-03-31')
    // 無期限は validTo 無し
    expect(entries[2]?.validTo).toBeUndefined()
  })

  it('BOM を除去できる', () => {
    const { entries } = parseFuelEfficiencyCsv('﻿' + SAMPLE_CSV)
    expect(entries).toHaveLength(3)
  })

  it('空 CSV', () => {
    expect(parseFuelEfficiencyCsv('').warnings).toContain('空の CSV')
  })

  it('燃費が非数値 / 0 以下 → 警告 + 除外', () => {
    const csv = '車種C,車種名,燃費,有効開始,有効終了\n04,大型車,abc,2026-01-01,\n05,小型車,0,2026-01-01,\n'
    const { entries, warnings } = parseFuelEfficiencyCsv(csv)
    expect(entries).toHaveLength(0)
    expect(warnings.filter((w) => w.includes('燃費が非数値か 0 以下'))).toHaveLength(2)
  })

  it('日付形式不正 → 警告 + 除外', () => {
    const csv = '車種C,車種名,燃費,有効開始,有効終了\n04,大型車,3.5,2026/01/01,\n05,小型車,4,2026-01-01,bad\n'
    const { entries, warnings } = parseFuelEfficiencyCsv(csv)
    expect(entries).toHaveLength(0)
    expect(warnings.some((w) => w.includes('有効開始の日付形式'))).toBe(true)
    expect(warnings.some((w) => w.includes('有効終了の日付形式'))).toBe(true)
  })

  it('期間逆転 (終了 < 開始) → 警告 + 除外', () => {
    const csv = '車種C,車種名,燃費,有効開始,有効終了\n04,大型車,3.5,2026-04-01,2026-01-01\n'
    const { entries, warnings } = parseFuelEfficiencyCsv(csv)
    expect(entries).toHaveLength(0)
    expect(warnings.some((w) => w.includes('より前'))).toBe(true)
  })

  it('車種C 空 / (車種C,有効開始) 重複 → 警告 + 除外', () => {
    const csv =
      '車種C,車種名,燃費,有効開始,有効終了\n' +
      ',大型車,3.5,2026-01-01,\n' +
      '04,大型車,3.5,2026-01-01,\n' +
      '04,大型車,4.0,2026-01-01,\n'
    const { entries, warnings } = parseFuelEfficiencyCsv(csv)
    expect(entries).toHaveLength(1)
    expect(warnings.some((w) => w.includes('車種C が空'))).toBe(true)
    expect(warnings.some((w) => w.includes('重複'))).toBe(true)
  })

  it('ヘッダ無しでもデータ行を読む', () => {
    const { entries } = parseFuelEfficiencyCsv('04,大型車,3.5,2026-01-01,\n')
    expect(entries).toHaveLength(1)
  })
})

describe('serializeFuelEfficiencyCsv / round-trip', () => {
  it('parse → serialize → parse で一致する', () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const out = serializeFuelEfficiencyCsv(entries)
    expect(out.charCodeAt(0)).toBe(0xfeff) // BOM
    const second = parseFuelEfficiencyCsv(out)
    expect(second.warnings).toEqual([])
    expect(second.entries).toEqual(entries)
  })

  it('空でもヘッダ行を出す (テンプレート用)', () => {
    const out = serializeFuelEfficiencyCsv([])
    expect(out.replace('﻿', '').trim()).toBe('車種C,車種名,燃費,有効開始,有効終了')
  })

  it('formula injection: 危険な先頭文字を無害化する', () => {
    const out = serializeFuelEfficiencyCsv([
      { sharuC: '=cmd', name: '@SUM(A1)', kmPerL: 3, validFrom: '2026-01-01' },
    ]).replace('﻿', '')
    expect(out).toContain("'=cmd")
    expect(out).toContain("'@SUM(A1)")
  })
})

describe('resolveFuelEfficiency — 有効期間解決', () => {
  const entries = parseFuelEfficiencyCsv(SAMPLE_CSV).entries

  it('期間内の燃費を引く', () => {
    expect(resolveFuelEfficiency(entries, '04', '2026-02-15')).toBe(3.5)
    expect(resolveFuelEfficiency(entries, '16', '2026-02-15')).toBe(3.0)
  })

  it('改定後は新しい値 (有効開始が新しい方を採用)', () => {
    expect(resolveFuelEfficiency(entries, '16', '2026-05-01')).toBe(3.2)
  })

  it('境界日を含む (開始・終了とも inclusive)', () => {
    expect(resolveFuelEfficiency(entries, '16', '2026-03-31')).toBe(3.0)
    expect(resolveFuelEfficiency(entries, '16', '2026-04-01')).toBe(3.2)
  })

  it('開始前は該当なし (undefined)', () => {
    expect(resolveFuelEfficiency(entries, '04', '2025-12-31')).toBeUndefined()
  })

  it('未登録車種は undefined', () => {
    expect(resolveFuelEfficiency(entries, '99', '2026-02-15')).toBeUndefined()
  })

  it('無期限 (validTo 空) は終了後も有効', () => {
    expect(resolveFuelEfficiency(entries, '04', '2099-12-31')).toBe(3.5)
  })
})

describe('toEfficiencyLookup → surcharge エンジン連携', () => {
  it('lookup 関数を SurchargeMasters.fuelEfficiency に渡せる', () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const masters: SurchargeMasters = {
      basePrice: 100,
      monthlyDieselPrice: { '2026-02': 130 },
      fuelEfficiency: toEfficiencyLookup(entries),
      distanceKm: { ['長崎県\t福岡県']: 155 },
    }
    const row: MeisaiRow = {
      tokuiC: 'T1',
      fromPref: '長崎県',
      toPref: '福岡県',
      sharuC: '04',
      uriageDate: '2026-02-10',
      unchin: 0,
      seikyuDate: '2026-03-31',
    }
    const r = computeRowSurcharge(row, masters)
    // 上昇額27.5 × 155 ÷ 3.5 = 1217.85… → ceil 1218
    expect(r.status).toBe('ok')
    expect(r.efficiency).toBe(3.5)
    expect(r.amount).toBe(Math.ceil((27.5 * 155) / 3.5))
  })

  it('期間外の売上日は燃費未定義 → 警告', () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const masters: SurchargeMasters = {
      basePrice: 100,
      monthlyDieselPrice: { '2025-12': 130 },
      fuelEfficiency: toEfficiencyLookup(entries),
      distanceKm: { ['長崎県\t福岡県']: 155 },
    }
    const row: MeisaiRow = {
      tokuiC: 'T1',
      fromPref: '長崎県',
      toPref: '福岡県',
      sharuC: '04',
      uriageDate: '2025-12-10', // 有効開始前
      unchin: 0,
      seikyuDate: '2026-01-31',
    }
    const r = computeRowSurcharge(row, masters)
    expect(r.status).toBe('warning')
    expect(r.warning).toContain('燃費未定義')
  })
})
