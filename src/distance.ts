// 県庁間距離マスタ CSV の parse / serialize (距離制の input / download)
//
// docs/surcharge/kenchokan-distance.csv (47×47、UTF-8 BOM) を読み、
// src/surcharge.ts の SurchargeMasters.distanceKm (キー `積地県\t卸地県`、対称) に
// そのまま流し込める形へ展開する。逆方向 (download) も round-trip 一致で出力する。
//
// CSV 形式:
//   都道府県,県庁所在地,<北海道>,<青森県>,...,<沖縄県>   (ヘッダ)
//   北海道,札幌市,0,440,...                              (データ行)
//
// Refs ohishi-exp/nuxt-ichibanboshi-seikyu#11 (A: 県庁間距離 CSV loader)

/** distanceKm のキー (surcharge.ts と同一規約: `積地県\t卸地県`) */
export function distanceKey(from: string, to: string): string {
  return `${from}\t${to}`
}

/** 県庁間距離マスタ (parse 結果 / serialize 入力) */
export interface DistanceMaster {
  /** 列・行の都道府県順 (47 県) */
  prefs: string[]
  /** 都道府県 -> 県庁所在地 */
  cities: Record<string, string>
  /** `積地県\t卸地県` -> km。surcharge.ts の distanceKm にそのまま渡せる */
  distanceKm: Record<string, number>
}

export interface ParseDistanceResult {
  master: DistanceMaster
  /** 取り込み時の警告 (非数値セル・未知県・自県距離≠0 等)。fatal ではない */
  warnings: string[]
}

const BOM = '﻿'

/** 1 行を素朴に CSV split する (距離マスタは引用符・埋め込みカンマ無し) */
function splitCsvLine(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

/**
 * 県庁間距離 CSV を parse して DistanceMaster + 警告を返す。
 *
 * - 1 行目はヘッダ (`都道府県,県庁所在地,<県名>...`)。3 列目以降が列県名。
 * - データ行は `県名,県庁所在地,<距離>...`。距離セルは列県名と対応。
 * - 空セル / 非数値セルは distanceKm に入れず警告。自県 (from===to) は 0 を入れる。
 * - 行県名がヘッダ県名に無い、行数とヘッダ県数の不一致なども警告。
 */
export function parseDistanceCsv(csv: string): ParseDistanceResult {
  const warnings: string[] = []
  const text = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { master: { prefs: [], cities: {}, distanceKm: {} }, warnings: ['空の CSV'] }
  }

  const headerLine = lines[0]
  if (headerLine === undefined) {
    return { master: { prefs: [], cities: {}, distanceKm: {} }, warnings: ['空の CSV'] }
  }
  const header = splitCsvLine(headerLine)
  if (header.length < 3) {
    return {
      master: { prefs: [], cities: {}, distanceKm: {} },
      warnings: ['ヘッダ列が不足 (都道府県,県庁所在地,<県名>... が必要)'],
    }
  }
  const prefs = header.slice(2)
  const prefSet = new Set(prefs)
  const cities: Record<string, string> = {}
  const distanceKm: Record<string, number> = {}
  const seenRows = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const cols = splitCsvLine(line)
    const rowPref = cols[0]
    if (!rowPref) {
      warnings.push(`行 ${i + 1}: 都道府県が空`)
      continue
    }
    if (!prefSet.has(rowPref)) {
      warnings.push(`行 ${i + 1}: ヘッダに無い都道府県 "${rowPref}"`)
      continue
    }
    if (seenRows.has(rowPref)) {
      warnings.push(`行 ${i + 1}: 都道府県 "${rowPref}" が重複`)
      continue
    }
    seenRows.add(rowPref)
    cities[rowPref] = cols[1] ?? ''

    const dists = cols.slice(2)
    if (dists.length !== prefs.length) {
      warnings.push(
        `行 ${i + 1} (${rowPref}): 距離列数 ${dists.length} がヘッダ県数 ${prefs.length} と不一致`,
      )
    }
    for (let j = 0; j < prefs.length; j++) {
      const colPref = prefs[j]
      if (colPref === undefined) continue
      const raw = dists[j]
      if (raw === undefined || raw === '') {
        warnings.push(`${rowPref}→${colPref}: 距離セルが空`)
        continue
      }
      const num = Number(raw)
      if (!Number.isFinite(num)) {
        warnings.push(`${rowPref}→${colPref}: 距離が非数値 "${raw}"`)
        continue
      }
      if (rowPref === colPref && num !== 0) {
        warnings.push(`${rowPref}: 自県距離が 0 でない (${num})`)
      }
      distanceKm[distanceKey(rowPref, colPref)] = num
    }
  }

  const missing = prefs.filter((p) => !seenRows.has(p))
  if (missing.length > 0) {
    warnings.push(`データ行が無い都道府県: ${missing.join(', ')}`)
  }

  return { master: { prefs, cities, distanceKm }, warnings }
}

// CSV / formula injection 対策 (OWASP)。先頭が = + - @ TAB CR のセルは ' を前置し、
// download した CSV を Excel/Sheets で開いた時に数式として実行されるのを防ぐ。
// アップロード由来の city / 県名が悪意ある値でも download 側で無害化する。
function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

/**
 * DistanceMaster を CSV 文字列へ serialize する (download 用、UTF-8 BOM 付き)。
 * parseDistanceCsv と round-trip 一致する (正常値)。自県は 0、未登録ペアは空セル。
 * 文字列セル (県名 / 県庁所在地) は formula injection 対策で csvSafe する。
 */
export function serializeDistanceCsv(master: DistanceMaster): string {
  const { prefs, cities, distanceKm } = master
  const lines: string[] = []
  lines.push(['都道府県', '県庁所在地', ...prefs].map(csvSafe).join(','))
  for (const from of prefs) {
    const row = [csvSafe(from), csvSafe(cities[from] ?? '')]
    for (const to of prefs) {
      if (from === to) {
        row.push('0')
        continue
      }
      const v = distanceKm[distanceKey(from, to)]
      row.push(v === undefined ? '' : String(v))
    }
    lines.push(row.join(','))
  }
  return BOM + lines.join('\n') + '\n'
}
