import { describe, it, expect } from 'vitest'
import {
  generateIncrementTable,
  TIME_BASED_DISTANCES,
  NOTIFICATION_BASE_PRICE,
  NOTIFICATION_PRICE_STEP,
  NOTIFICATION_MAX_PRICE,
  type IncrementBand,
} from '../src/notification-form'

describe('generateIncrementTable — 段階上昇額テーブル (届出書)', () => {
  const table = generateIncrementTable()

  it('既定 (base100 / step5 / max185) で 17 帯', () => {
    // k = 0..16 (100+5k < 185)
    expect(table).toHaveLength(17)
  })

  it('先頭帯 = (100, 105] 代表102.5 上昇額2.5', () => {
    expect(table[0]).toEqual<IncrementBand>({
      lowerExclusive: 100,
      upperInclusive: 105,
      representative: 102.5,
      increment: 2.5,
    })
  })

  it('(125, 130] 帯 = 代表127.5 上昇額27.5 (計算エンジンと一致)', () => {
    const band = table.find((b) => b.upperInclusive === 130)
    expect(band).toEqual<IncrementBand>({
      lowerExclusive: 125,
      upperInclusive: 130,
      representative: 127.5,
      increment: 27.5,
    })
  })

  it('末尾帯 = (180, 185] 代表182.5 上昇額82.5', () => {
    expect(table[table.length - 1]).toEqual<IncrementBand>({
      lowerExclusive: 180,
      upperInclusive: 185,
      representative: 182.5,
      increment: 82.5,
    })
  })

  it('上昇額は常に 代表価格 − 基準価格', () => {
    for (const b of table) {
      expect(b.increment).toBeCloseTo(b.representative - NOTIFICATION_BASE_PRICE, 10)
    }
  })

  it('帯は連続 (前の上限 = 次の下限)', () => {
    for (let i = 1; i < table.length; i++) {
      expect(table[i]!.lowerExclusive).toBe(table[i - 1]!.upperInclusive)
    }
  })

  it('step を変えると刻みが変わる (step10)', () => {
    const t = generateIncrementTable(100, 10, 130)
    // (100,110] (110,120] (120,130]
    expect(t).toHaveLength(3)
    expect(t[0]).toEqual<IncrementBand>({
      lowerExclusive: 100,
      upperInclusive: 110,
      representative: 105,
      increment: 5,
    })
    expect(t[2]?.increment).toBe(25)
  })

  it('step <= 0 は空 (防御)', () => {
    expect(generateIncrementTable(100, 0, 185)).toEqual([])
  })

  it('既定定数', () => {
    expect(NOTIFICATION_BASE_PRICE).toBe(100)
    expect(NOTIFICATION_PRICE_STEP).toBe(5)
    expect(NOTIFICATION_MAX_PRICE).toBe(185)
  })
})

describe('TIME_BASED_DISTANCES — 時間制 1日平均走行距離', () => {
  it('4 区分', () => {
    expect(TIME_BASED_DISTANCES).toHaveLength(4)
    expect(TIME_BASED_DISTANCES.map((d) => d.category)).toEqual([
      '小型車',
      '中型車',
      '大型車',
      'トレーラー',
    ])
  })

  it('小型 100/50、その他 130/60', () => {
    expect(TIME_BASED_DISTANCES[0]).toEqual({ category: '小型車', h8: 100, h4: 50 })
    expect(TIME_BASED_DISTANCES[3]).toEqual({ category: 'トレーラー', h8: 130, h4: 60 })
  })
})
