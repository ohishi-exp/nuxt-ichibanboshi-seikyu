// 締め日別 得意先別サーチャージの CSV 出力 (一番星へ手動入力する元票)。Refs #6
//
// 確認後、得意先別サーチャージを CSV 出力 → 一番星へ手動入力する。一番星入力に必要な
// 得意先C・締め日(請求日/入金予定日)・サーチャージ額・品名 を出す。サーチャージ額が
// 0 の取引先 (= 計上なし) は元票に出さない。
// 統一品名 (#7) は未確定のため、暫定で SHIMEBI_HINMOKU を既定にする (確定後に差し替え)。

import type { ShimebiCustomerRow } from './shimebi-summary'

/** 暫定の統一品名 (#7 で正式確定するまでの既定値) */
export const SHIMEBI_HINMOKU = '燃料サーチャージ'

/** CSV セル 1 個をエスケープする (カンマ/改行/引用符を含むなら "" で括る) */
function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 締め日別の得意先別サーチャージを CSV 文字列に変換する (純粋)。
 * 列: 得意先コード,取引先名,締め日,サーチャージ金額,品名,登録
 * サーチャージ金額 > 0 の行のみ。改行は CRLF (Excel/一番星取込を考慮)。
 */
export function buildShimebiCsv(
  rows: ShimebiCustomerRow[],
  shimebiDate: string,
  hinmoku: string = SHIMEBI_HINMOKU,
): string {
  const header = ['得意先コード', '取引先名', '締め日', 'サーチャージ金額', '品名', '登録']
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    if (r.surchargeTotal <= 0) continue
    lines.push(
      [
        csvCell(r.customerCode),
        csvCell(r.customerName),
        csvCell(shimebiDate),
        csvCell(r.surchargeTotal),
        csvCell(hinmoku),
        csvCell(r.registered ? '登録済' : '未登録'),
      ].join(','),
    )
  }
  return lines.join('\r\n')
}
