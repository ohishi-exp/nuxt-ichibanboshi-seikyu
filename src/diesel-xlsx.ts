// 資源エネルギー庁 給油所小売価格 週次 xlsx (例 260617s5.xlsx) の「軽油」シートから
// 全国平均価格を月次平均に集約する純粋ロジック。Refs #11 (#2 自動取得 Phase 2)
//
// シート構造 (inspect で確認):
//   行0 = ヘッダ (col1="調査日", col2="全 国", col3 以降 = 地域別)
//   行1〜 = データ。col1 = 調査日 (Excel シリアル値), col2 = 全国平均価格 (円/L)
// 小売は週次のみ (月次概要なし) なので、同一月の週次値を平均して月次価格とする。

import type { DieselPriceEntry } from './diesel-price'

/** 軽油シートのシート名・列インデックス */
export const KEIYU_SHEET_NAME = '軽油'
const DATE_COL = 1
const NATIONAL_COL = 2
const DATA_START_ROW = 1

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30) // serial 0 = 1899-12-30 (Excel 1900 date system)

/**
 * Excel シリアル日付 → "YYYY-MM"。範囲外/非有限は null。
 * (serial >= 61 で 1900-02-29 バグ域を超えるため週次調査日には影響しない)
 */
export function excelSerialToMonth(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null
  const d = new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86400000)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export interface ExtractOptions {
  /** 直近 N ヶ月のみ返す (古い全履歴 upsert を避ける)。省略時は全月 */
  recentMonths?: number
  /** 月次平均の小数桁数 (既定 1) */
  decimals?: number
}

/**
 * 「軽油」シート (array-of-arrays) から全国平均価格を月次平均に集約する。
 * col1=調査日(シリアル) / col2=全国価格 の数値行のみ採用。月ごとに単純平均。
 */
export function extractMonthlyDieselAverages(
  aoa: unknown[][],
  opts: ExtractOptions = {},
): DieselPriceEntry[] {
  const decimals = opts.decimals ?? 1
  const sums = new Map<string, { sum: number; count: number }>()

  for (let r = DATA_START_ROW; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const serial = Number(row[DATE_COL])
    const price = Number(row[NATIONAL_COL])
    if (!Number.isFinite(serial) || !Number.isFinite(price) || price <= 0) continue
    const month = excelSerialToMonth(serial)
    if (month === null) continue
    const cur = sums.get(month) ?? { sum: 0, count: 0 }
    cur.sum += price
    cur.count += 1
    sums.set(month, cur)
  }

  const factor = 10 ** decimals
  let entries: DieselPriceEntry[] = [...sums.entries()]
    .map(([month, { sum, count }]) => ({
      month,
      price: Math.round((sum / count) * factor) / factor,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  if (opts.recentMonths !== undefined && opts.recentMonths > 0) {
    entries = entries.slice(-opts.recentMonths)
  }
  return entries
}
