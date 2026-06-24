// 締め日別 明細の「行単位 再取得」で、特定 row_id の行だけを最新結果に差し替える純粋関数。Refs #63
//
// producer は範囲取得のみで単一行 endpoint が無いため、範囲を取り直した結果 (fresh) から
// 対象 row_id の行を抜き出し、現在表示中 (current) の同 row_id 行を置き換える。
// 同一 row_id が複数行ある場合 (積み合わせ等) は、最初の出現位置にまとめて差し込み、
// 残りの旧行は取り除く (= グループ単位で差し替え、表示順は維持)。

import type { SurchargeResult } from './surcharge'

/**
 * current の中で row.rowId === rowId の行群を fresh で置き換える (純粋・新配列を返す)。
 * - row_id が current に無ければ current をそのまま返す (差し替え対象なし)
 * - fresh が空 (取得結果に該当行が無い = source から消えた) でも、旧行を取り除く
 */
export function replaceResultsByRowId(
  current: SurchargeResult[],
  rowId: string,
  fresh: SurchargeResult[],
): SurchargeResult[] {
  if (!rowId) return current
  if (!current.some((r) => r.row.rowId === rowId)) return current
  const out: SurchargeResult[] = []
  let inserted = false
  for (const r of current) {
    if (r.row.rowId === rowId) {
      if (!inserted) {
        out.push(...fresh)
        inserted = true
      }
      // 旧 row_id 行はスキップ (fresh で代替済み)
    } else {
      out.push(r)
    }
  }
  return out
}
