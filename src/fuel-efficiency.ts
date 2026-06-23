// 燃費マスタ CSV の parse / serialize + 有効期間つき燃費の解決。Refs #11 (#1 マスタ整備 / #11-B 届出書)
//
// 燃費の実値は車種ごとに「いつから・いつまで」で改定され得るため、単一値ではなく
// 有効期間 (validFrom / validTo) つきのレコード列として持つ。売上年月日に応じて
// その時点で有効な燃費を引く (resolveFuelEfficiency)。
//
// CSV 形式 (UTF-8 BOM、1 行 1 レコード):
//   車種C,車種名,燃費,有効開始,有効終了
//   04,大型車,3.5,2026-01-01,
//   16,トレーラー,3.0,2026-01-01,2026-03-31
//
// - 車種C: src/surcharge.ts の MeisaiRow.sharuC と突合するキー
// - 燃費: km/L (小数可)
// - 有効開始: YYYY-MM-DD (必須)
// - 有効終了: YYYY-MM-DD (空 = 無期限)。同一車種で期間が重なる場合は有効開始が新しい方を優先

/** 燃費マスタ 1 レコード (車種 × 有効期間) */
export interface FuelEfficiencyEntry {
  /** 車種C (MeisaiRow.sharuC と一致させる) */
  sharuC: string
  /** 車種名 (表示用、例: 大型車 / トレーラー) */
  name: string
  /** 燃費 km/L */
  kmPerL: number
  /** 有効開始 (YYYY-MM-DD、含む) */
  validFrom: string
  /** 有効終了 (YYYY-MM-DD、含む)。空 = 無期限 */
  validTo?: string
}

export interface ParseFuelEfficiencyResult {
  entries: FuelEfficiencyEntry[]
  /** 取り込み時の警告 (非数値燃費・日付形式不正・期間逆転・重複等)。fatal ではない */
  warnings: string[]
}

const BOM = '﻿'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function splitCsvLine(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

/**
 * 燃費マスタ CSV を parse して FuelEfficiencyEntry[] + 警告を返す。
 *
 * - 1 行目はヘッダ (`車種C,車種名,燃費,有効開始,有効終了`)。判定は緩く、列順固定。
 * - 燃費が非数値 / 0 以下、日付形式不正、期間逆転 (終了 < 開始) は警告し当該行を除外。
 * - 同一 (車種C, 有効開始) の重複は後勝ちにせず警告 + 除外 (D1 PK と整合)。
 */
export function parseFuelEfficiencyCsv(csv: string): ParseFuelEfficiencyResult {
  const warnings: string[] = []
  const text = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { entries: [], warnings: ['空の CSV'] }
  }

  // ヘッダ行を検出 (1 列目が "車種C" 等) してあれば飛ばす。無くてもデータとして扱わない緩い判定。
  let start = 0
  const first = lines[0]
  if (first !== undefined) {
    const h0 = splitCsvLine(first)[0] ?? ''
    if (h0 === '車種C' || h0 === '車種' || h0.toLowerCase() === 'sharu_c') start = 1
  }

  const entries: FuelEfficiencyEntry[] = []
  const seen = new Set<string>()
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const cols = splitCsvLine(line)
    const sharuC = cols[0] ?? ''
    if (!sharuC) {
      warnings.push(`行 ${i + 1}: 車種C が空`)
      continue
    }
    const name = cols[1] ?? ''
    const rawKm = cols[2] ?? ''
    const validFrom = cols[3] ?? ''
    const validTo = cols[4] ?? ''

    const km = Number(rawKm)
    if (!Number.isFinite(km) || km <= 0) {
      warnings.push(`行 ${i + 1} (${sharuC}): 燃費が非数値か 0 以下 "${rawKm}"`)
      continue
    }
    if (!DATE_RE.test(validFrom)) {
      warnings.push(`行 ${i + 1} (${sharuC}): 有効開始の日付形式が不正 "${validFrom}" (YYYY-MM-DD)`)
      continue
    }
    if (validTo !== '' && !DATE_RE.test(validTo)) {
      warnings.push(`行 ${i + 1} (${sharuC}): 有効終了の日付形式が不正 "${validTo}" (YYYY-MM-DD or 空)`)
      continue
    }
    if (validTo !== '' && validTo < validFrom) {
      warnings.push(`行 ${i + 1} (${sharuC}): 有効終了 ${validTo} が有効開始 ${validFrom} より前`)
      continue
    }
    const dupKey = `${sharuC}\t${validFrom}`
    if (seen.has(dupKey)) {
      warnings.push(`行 ${i + 1} (${sharuC}): 有効開始 ${validFrom} が重複`)
      continue
    }
    seen.add(dupKey)
    const entry: FuelEfficiencyEntry = { sharuC, name, kmPerL: km, validFrom }
    if (validTo !== '') entry.validTo = validTo
    entries.push(entry)
  }
  return { entries, warnings }
}

// CSV / formula injection 対策 (OWASP)。先頭が = + - @ TAB CR のセルは ' を前置する。
function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

/**
 * FuelEfficiencyEntry[] を CSV へ serialize する (download 用、UTF-8 BOM 付き)。
 * 車種C → 有効開始 の昇順で安定出力し、parse と round-trip 一致する。空でもヘッダは出す。
 */
export function serializeFuelEfficiencyCsv(entries: FuelEfficiencyEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.sharuC === b.sharuC
      ? a.validFrom.localeCompare(b.validFrom)
      : a.sharuC.localeCompare(b.sharuC),
  )
  const lines: string[] = ['車種C,車種名,燃費,有効開始,有効終了']
  for (const e of sorted) {
    lines.push(
      [
        csvSafe(e.sharuC),
        csvSafe(e.name),
        String(e.kmPerL),
        e.validFrom,
        e.validTo ?? '',
      ].join(','),
    )
  }
  return BOM + lines.join('\n') + '\n'
}

/**
 * 指定日 (YYYY-MM-DD) 時点で有効な車種別燃費 km/L を引く。
 * 期間が重なる場合は有効開始が最も新しいものを採用。該当なしは undefined。
 */
export function resolveFuelEfficiency(
  entries: FuelEfficiencyEntry[],
  sharuC: string,
  date: string,
): number | undefined {
  let best: FuelEfficiencyEntry | undefined
  for (const e of entries) {
    if (e.sharuC !== sharuC) continue
    if (date < e.validFrom) continue
    if (e.validTo !== undefined && e.validTo !== '' && date > e.validTo) continue
    if (best === undefined || e.validFrom > best.validFrom) best = e
  }
  return best?.kmPerL
}

/**
 * FuelEfficiencyEntry[] を surcharge エンジンの fuelEfficiency lookup 関数に変換する。
 * SurchargeMasters.fuelEfficiency にそのまま渡せる ((sharuC, date) => number | undefined)。
 */
export function toEfficiencyLookup(
  entries: FuelEfficiencyEntry[],
): (sharuC: string, date: string) => number | undefined {
  return (sharuC, date) => resolveFuelEfficiency(entries, sharuC, date)
}
