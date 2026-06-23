import { describe, it, expect } from 'vitest'
import {
  parseDieselPriceCsv,
  serializeDieselPriceCsv,
  validateDieselPriceEntry,
  toMonthlyPriceMap,
  type DieselPriceEntry,
} from '../src/diesel-price'

const SAMPLE = '年月,軽油価格\n2026-04,168.5\n2026-05,170.0\n2026-06,172.25\n'

describe('parseDieselPriceCsv', () => {
  it('ヘッダ + 3 行を取り込む', () => {
    const { entries, warnings } = parseDieselPriceCsv(SAMPLE)
    expect(warnings).toEqual([])
    expect(entries).toEqual<DieselPriceEntry[]>([
      { month: '2026-04', price: 168.5 },
      { month: '2026-05', price: 170.0 },
      { month: '2026-06', price: 172.25 },
    ])
  })

  it('BOM 除去 / ヘッダ無しでも読む', () => {
    expect(parseDieselPriceCsv('﻿' + SAMPLE).entries).toHaveLength(3)
    expect(parseDieselPriceCsv('2026-04,168.5\n').entries).toHaveLength(1)
  })

  it('空 CSV', () => {
    expect(parseDieselPriceCsv('').warnings).toContain('空の CSV')
  })

  it('年月形式不正 → 警告 + 除外', () => {
    const { entries, warnings } = parseDieselPriceCsv('年月,軽油価格\n2026/04,168\n26-4,168\n')
    expect(entries).toHaveLength(0)
    expect(warnings.filter((w) => w.includes('年月の形式'))).toHaveLength(2)
  })

  it('非数値 / 0 以下 → 警告 + 除外', () => {
    const { entries, warnings } = parseDieselPriceCsv('年月,軽油価格\n2026-04,abc\n2026-05,0\n2026-06,-5\n')
    expect(entries).toHaveLength(0)
    expect(warnings.filter((w) => w.includes('軽油価格が非数値か 0 以下'))).toHaveLength(3)
  })

  it('年月重複 → 警告 + 除外 (先勝ち)', () => {
    const { entries, warnings } = parseDieselPriceCsv('年月,軽油価格\n2026-04,168\n2026-04,170\n')
    expect(entries).toEqual<DieselPriceEntry[]>([{ month: '2026-04', price: 168 }])
    expect(warnings.some((w) => w.includes('重複'))).toBe(true)
  })
})

describe('serializeDieselPriceCsv / round-trip', () => {
  it('parse → serialize → parse が一致 (年月昇順・BOM)', () => {
    const { entries } = parseDieselPriceCsv(SAMPLE)
    const out = serializeDieselPriceCsv([...entries].reverse())
    expect(out.charCodeAt(0)).toBe(0xfeff)
    const second = parseDieselPriceCsv(out)
    expect(second.warnings).toEqual([])
    expect(second.entries).toEqual(entries) // 昇順に正規化される
  })

  it('空でもヘッダ行を出す', () => {
    expect(serializeDieselPriceCsv([]).replace('﻿', '').trim()).toBe('年月,軽油価格')
  })

  it('formula injection 無害化', () => {
    const out = serializeDieselPriceCsv([{ month: '=cmd', price: 1 }]).replace('﻿', '')
    expect(out).toContain("'=cmd")
  })
})

describe('validateDieselPriceEntry', () => {
  it('正常 → null', () => {
    expect(validateDieselPriceEntry({ month: '2026-04', price: 168.5 })).toBeNull()
  })
  it('年月形式不正 → エラー', () => {
    expect(validateDieselPriceEntry({ month: '2026/04', price: 168 })).toContain('年月')
  })
  it('価格 0 以下 / 非数値 → エラー', () => {
    expect(validateDieselPriceEntry({ month: '2026-04', price: 0 })).toContain('軽油価格')
    expect(validateDieselPriceEntry({ month: '2026-04', price: NaN })).toContain('軽油価格')
  })
})

describe('toMonthlyPriceMap → surcharge エンジン連携', () => {
  it('Record<YYYY-MM, number> に変換', () => {
    const { entries } = parseDieselPriceCsv(SAMPLE)
    expect(toMonthlyPriceMap(entries)).toEqual({
      '2026-04': 168.5,
      '2026-05': 170.0,
      '2026-06': 172.25,
    })
  })
})
