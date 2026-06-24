// 入力者別 明細タブの純粋ロジック。
//
// 締め日別 (取引先別 集計) とは別に、運転日報明細 1 行 = 1 行で並べる「入力者別 明細」を組み立てる。
// 締め日 (請求日) には連動せず、呼び出し側が直近 1 ヶ月 (前月) の範囲で取得した計算結果を渡す。
//
// フィルタ:
//   - 入力者を選択中 (selectedStaff !== '') → その入力担当C の明細のみ
//   - 入力者なし (selectedStaff === '')     → サーチャージ対象に登録済みの取引先の明細のみ (全入力者)

import type { SurchargeResult } from './surcharge'
import { reconcileRow, ownershipLabel } from './surcharge-review'

/** 入力者別 明細 1 行 (運転日報明細 1 行に対応) */
export interface InputStaffRow {
  /** 入力担当C (入力者) */
  inputStaffCode: string
  /** 入力者氏名 (社員ﾏｽﾀ.社員N、未マップは空) */
  inputStaffName: string
  /** 売上年月日 (YYYY-MM-DD) */
  saleDate: string
  /** 請求日 (入金予定日、空あり) */
  billingDate: string
  customerCode: string
  customerName: string
  /** 車輌C (車番) */
  vehicleNumber: string
  /** 車種N */
  vehicleName: string
  /** 積地県 */
  fromPref: string
  /** 卸地県 */
  toPref: string
  /** 自車 / 傭車 / — */
  ownership: '自車' | '傭車' | '—'
  /** 運賃 */
  fare: number
  /** 計算サーチャージ (status==='ok' 以外は 0) */
  computed: number
  /** 実額サーチャージ (割増C=19) */
  actual: number
  /** 差額 = 計算 − 実額 */
  diff: number
  /** サーチャージ対象 登録済みか */
  registered: boolean
}

/**
 * 計算結果から「入力者別 明細」行を組み立てる (純粋)。
 * - `selectedStaff` 指定時: その入力担当C の行のみ
 * - `selectedStaff` 空 ('')   : `isRegistered` が true の取引先の行のみ (= 登録済みのみ全員表示)
 * 並び順は 入力者 → 売上年月日 → 取引先コード。
 */
export function buildInputStaffRows(
  results: SurchargeResult[],
  isRegistered: (code: string) => boolean,
  selectedStaff: string,
): InputStaffRow[] {
  const filtered = results.filter((r) =>
    selectedStaff ? (r.row.inputStaffCode ?? '') === selectedStaff : isRegistered(r.row.tokuiC),
  )
  const rows: InputStaffRow[] = filtered.map((r) => {
    const rec = reconcileRow(r)
    return {
      inputStaffCode: r.row.inputStaffCode ?? '',
      inputStaffName: r.row.inputStaffName ?? '',
      saleDate: r.row.uriageDate,
      billingDate: r.row.seikyuDate ?? '',
      customerCode: r.row.tokuiC,
      customerName: r.row.tokuiName ?? '',
      vehicleNumber: r.row.vehicleNumber ?? '',
      vehicleName: r.row.vehicleName ?? '',
      fromPref: r.row.fromPref,
      toPref: r.row.toPref,
      ownership: ownershipLabel(r.row.subcontractorCode),
      fare: r.row.unchin,
      computed: rec.computed,
      actual: rec.actual,
      diff: rec.diff,
      registered: isRegistered(r.row.tokuiC),
    }
  })
  return rows.sort(
    (a, b) =>
      a.inputStaffCode.localeCompare(b.inputStaffCode) ||
      a.saleDate.localeCompare(b.saleDate) ||
      a.customerCode.localeCompare(b.customerCode),
  )
}

/** 取得済み結果に含まれる入力担当C の一覧 (昇順・空欄除く)。入力者ドロップダウン用 (純粋) */
export function listInputStaffCodes(results: SurchargeResult[]): string[] {
  const set = new Set<string>()
  for (const r of results) {
    const code = r.row.inputStaffCode
    if (code) set.add(code)
  }
  return [...set].sort()
}

/** 入力者ドロップダウンの選択肢 (コード + 氏名)。`label` は氏名があれば「コード 氏名」、無ければコードのみ。 */
export interface InputStaffOption {
  code: string
  name: string
  label: string
}

/**
 * 取得済み結果から入力者の選択肢を組み立てる (純粋、コード昇順・空欄除く)。
 * 同一コードに複数の氏名候補があれば最初の非空を採用する (通常は 1 対 1)。
 */
export function listInputStaffOptions(results: SurchargeResult[]): InputStaffOption[] {
  const names = new Map<string, string>()
  for (const r of results) {
    const code = r.row.inputStaffCode
    if (!code) continue
    if (!names.get(code)) names.set(code, r.row.inputStaffName ?? '')
  }
  return [...names.keys()]
    .sort()
    .map((code) => {
      const name = names.get(code) ?? ''
      return { code, name, label: name ? `${code} ${name}` : code }
    })
}

const CSV_HEADER = [
  '入力者',
  '入力者氏名',
  '売上年月日',
  '請求日',
  '取引先コード',
  '取引先名',
  '車番',
  '車種',
  '積地県',
  '卸地県',
  '自車傭車',
  '運賃',
  '計算サーチャージ',
  '実額(割増C19)',
  '差額',
  '登録',
]

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 入力者別 明細を CSV 文字列にする (純粋、ヘッダ + 各行)。 */
export function buildInputStaffCsv(rows: InputStaffRow[]): string {
  const lines = [CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.inputStaffCode,
        r.inputStaffName,
        r.saleDate,
        r.billingDate,
        r.customerCode,
        r.customerName,
        r.vehicleNumber,
        r.vehicleName,
        r.fromPref,
        r.toPref,
        r.ownership,
        r.fare,
        r.computed,
        r.actual,
        r.diff,
        r.registered ? '登録済' : '未登録',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n')
}
