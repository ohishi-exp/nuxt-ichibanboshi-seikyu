// 積み合わせ (consolidation) 検出。Refs #63
//
// 同じ「売上日 + 車番 + 積地」の明細行が複数ある場合、同一車両・同一日・同一積地で
// 品目/卸地が異なる積み合わせ運行とみなし、確認用の警告 (薄い黄色) を出す。
// 積み合わせは 1 車の運行を品目/卸地ごとに複数行で持つため、行単位にサーチャージを
// 計算すると距離が重複計上され得る (要・人の確認)。
//
// 車番 (vehicleNumber) が無い行は「同一車両」を確定できないため検出対象外 (false)。

export interface KumiawaseRow {
  /** 売上年月日 (YYYY-MM-DD) */
  uriageDate: string
  /** 車番 (車輌C)。空/undefined は積み合わせ判定外 */
  vehicleNumber?: string
  /** 積地県 (正規化済) */
  fromPref: string
}

/** 行の積み合わせグループキー。車番が無ければ null (判定対象外) */
export function kumiawaseKey(r: KumiawaseRow): string | null {
  const vn = (r.vehicleNumber ?? '').trim()
  if (!vn) return null
  return `${r.uriageDate}\t${vn}\t${r.fromPref}`
}

/**
 * 同一 (売上日 + 車番 + 積地) が 2 行以上あるグループキーの集合を返す (純粋)。
 * このキーを持つ行が積み合わせ警告 (薄い黄色) の対象。
 */
export function detectKumiawaseKeys(rows: KumiawaseRow[]): Set<string> {
  const count = new Map<string, number>()
  for (const r of rows) {
    const k = kumiawaseKey(r)
    if (k) count.set(k, (count.get(k) ?? 0) + 1)
  }
  const keys = new Set<string>()
  for (const [k, n] of count) {
    if (n >= 2) keys.add(k)
  }
  return keys
}
