// 燃料サーチャージ届出用紙 (届出書) のための純粋ロジック。Refs #11-B
//
// 届出書 (官公庁提出) に載せる「算出上の上昇額 段階テーブル」と「時間制 1 日平均走行距離」を
// 生成する。計算エンジン (src/surcharge.ts) と同じ surchargeIncrement を使い、表示と実計算を
// single-source にする。届出書の前提値は docs/surcharge/SURCHARGE-SPEC.md 参照。

import { surchargeIncrement } from './surcharge'

/** 届出書の既定前提値 (条件設定シート由来) */
export const NOTIFICATION_BASE_PRICE = 100
export const NOTIFICATION_PRICE_STEP = 5
/** 上昇額テーブルを生成する上限軽油価格 (この価格を含む帯まで) */
export const NOTIFICATION_MAX_PRICE = 185

/** 上昇額テーブル 1 行 (5 円刻みの帯) */
export interface IncrementBand {
  /** 帯の下限 (この値は含まない = 超) */
  lowerExclusive: number
  /** 帯の上限 (この値を含む) */
  upperInclusive: number
  /** 代表価格 (帯の中点、下限 + step/2) */
  representative: number
  /** 上昇額 (代表価格 − 基準価格) */
  increment: number
}

/**
 * 段階方式の上昇額テーブルを生成する。
 * 帯 `(base + step·k, base + step·(k+1)]` の代表価格 = `base + step·k + step/2`、
 * 上昇額 = 代表価格 − 基準価格 (= surchargeIncrement で算出、計算エンジンと一致)。
 * 基準価格以下 (廃止帯) は含めない。`maxPrice` を含む帯まで生成する。
 */
export function generateIncrementTable(
  base: number = NOTIFICATION_BASE_PRICE,
  step: number = NOTIFICATION_PRICE_STEP,
  maxPrice: number = NOTIFICATION_MAX_PRICE,
): IncrementBand[] {
  const bands: IncrementBand[] = []
  if (step <= 0) return bands
  for (let k = 0; base + step * k < maxPrice; k++) {
    const representative = base + step * k + step / 2
    bands.push({
      lowerExclusive: base + step * k,
      upperInclusive: base + step * (k + 1),
      representative,
      increment: surchargeIncrement(representative, base, step),
    })
  }
  return bands
}

/** 時間制運賃の 1 日当たり平均走行距離 (車種区分別、km)。SURCHARGE-SPEC.md の表 */
export interface TimeBasedDistance {
  category: string
  /** 8 時間制 (km) */
  h8: number
  /** 4 時間制 (km) */
  h4: number
}

export const TIME_BASED_DISTANCES: readonly TimeBasedDistance[] = [
  { category: '小型車', h8: 100, h4: 50 },
  { category: '中型車', h8: 130, h4: 60 },
  { category: '大型車', h8: 130, h4: 60 },
  { category: 'トレーラー', h8: 130, h4: 60 },
]
