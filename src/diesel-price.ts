// 当月全国平均軽油価格マスタ CSV の parse / serialize + 検証 + engine 変換。Refs #11 (#2)
//
// 燃料サーチャージ計算の「当月軽油価格」(monthlyDieselPrice) を月別 (YYYY-MM → 円/L) で持つ。
// 石油情報センターの週間統計データ等から手入力 / CSV 取込する。計算エンジン
// (src/surcharge.ts) の SurchargeMasters.monthlyDieselPrice にそのまま渡せる Record に変換する。
//
// CSV 形式 (UTF-8 BOM、1 行 1 レコード):
//   年月,軽油価格
//   2026-04,168.5
//   2026-05,170.0

/** 軽油価格マスタ 1 レコード (当月 × 円/L) */
export interface DieselPriceEntry {
  /** 年月 (YYYY-MM) */
  month: string
  /** 当月全国平均軽油価格 (円/L) */
  price: number
}

export interface ParseDieselPriceResult {
  entries: DieselPriceEntry[]
  /** 取り込み時の警告 (年月形式不正・非数値・0 以下・重複)。fatal ではない */
  warnings: string[]
}

const BOM = '﻿'
const MONTH_RE = /^\d{4}-\d{2}$/

function splitCsvLine(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

/**
 * 軽油価格 CSV を parse して DieselPriceEntry[] + 警告を返す。
 * 1 行目が `年月` 始まりならヘッダとして飛ばす。年月形式不正 / 非数値 / 0 以下 /
 * 月重複は警告し当該行を除外する。
 */
export function parseDieselPriceCsv(csv: string): ParseDieselPriceResult {
  const warnings: string[] = []
  const text = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { entries: [], warnings: ['空の CSV'] }
  }

  let start = 0
  const first = lines[0]
  if (first !== undefined) {
    const h0 = splitCsvLine(first)[0] ?? ''
    if (h0 === '年月' || h0 === '月' || h0.toLowerCase() === 'month') start = 1
  }

  const entries: DieselPriceEntry[] = []
  const seen = new Set<string>()
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const cols = splitCsvLine(line)
    const month = cols[0] ?? ''
    const rawPrice = cols[1] ?? ''
    if (!MONTH_RE.test(month)) {
      warnings.push(`行 ${i + 1}: 年月の形式が不正 "${month}" (YYYY-MM)`)
      continue
    }
    const price = Number(rawPrice)
    if (!Number.isFinite(price) || price <= 0) {
      warnings.push(`行 ${i + 1} (${month}): 軽油価格が非数値か 0 以下 "${rawPrice}"`)
      continue
    }
    if (seen.has(month)) {
      warnings.push(`行 ${i + 1}: 年月 ${month} が重複`)
      continue
    }
    seen.add(month)
    entries.push({ month, price })
  }
  return { entries, warnings }
}

// CSV / formula injection 対策 (OWASP)。先頭が = + - @ TAB CR のセルは ' を前置する。
function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

/**
 * DieselPriceEntry[] を CSV へ serialize する (download 用、UTF-8 BOM 付き)。
 * 年月昇順で安定出力し parse と round-trip 一致する。空でもヘッダは出す。
 */
export function serializeDieselPriceCsv(entries: DieselPriceEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.month.localeCompare(b.month))
  const lines: string[] = ['年月,軽油価格']
  for (const e of sorted) {
    lines.push([csvSafe(e.month), String(e.price)].join(','))
  }
  return BOM + lines.join('\n') + '\n'
}

/** 単一の軽油価格レコード入力を検証する。問題があればメッセージ、無ければ null */
export function validateDieselPriceEntry(e: { month: string; price: number }): string | null {
  if (!MONTH_RE.test(e.month)) return '年月は YYYY-MM 形式で入力してください'
  if (!Number.isFinite(e.price) || e.price <= 0) return '軽油価格は 0 より大きい数値で入力してください'
  return null
}

/**
 * DieselPriceEntry[] を surcharge エンジンの monthlyDieselPrice (Record<"YYYY-MM", number>) に変換。
 * SurchargeMasters.monthlyDieselPrice にそのまま渡せる。
 */
export function toMonthlyPriceMap(entries: DieselPriceEntry[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const e of entries) map[e.month] = e.price
  return map
}
