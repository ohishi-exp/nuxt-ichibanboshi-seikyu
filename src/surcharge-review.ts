// 一番星 /api/surcharge/base のレスポンス行を計算エンジンの MeisaiRow に写像する純粋関数。
// Refs #11 (#5 確認 UI)
//
// 一番星 (rust-ichibanboshi) の SurchargeRow は county 正規化済み・運賃合算済みで返るので、
// ここでは field 名を MeisaiRow に合わせ、null の請求日を空文字に正規化するだけ。

import type { MeisaiRow } from './surcharge'

/** 一番星 GET /api/surcharge/base の data[] 1 行 (rust-ichibanboshi routes/surcharge.rs SurchargeRow) */
export interface IchibanSurchargeRow {
  request_kind: string
  customer_code: string
  customer_name: string
  origin_prefecture: string
  dest_prefecture: string
  vehicle_code: string
  vehicle_name: string
  sale_date: string
  fare: number
  billing_date: string | null
  /** 傭車先C ('000000' なら自車)。producer 旧版では欠落し得るため optional */
  subcontractor_code?: string
  /** 品名C (例: 0000=一括調整明細 / 9998=端数調整)。producer 旧版では欠落し得るため optional */
  item_code?: string
  /** 品名N (例: ※請求一括調整明細※)。producer 旧版では欠落し得るため optional */
  item_name?: string
}

/** 一番星 SurchargeRow[] → MeisaiRow[] (純粋)。請求日 null は空文字 (= 集計キーで空扱い) */
export function mapToMeisaiRows(rows: IchibanSurchargeRow[]): MeisaiRow[] {
  return rows.map((r) => ({
    tokuiC: r.customer_code,
    tokuiName: r.customer_name,
    fromPref: r.origin_prefecture,
    toPref: r.dest_prefecture,
    sharuC: r.vehicle_code,
    uriageDate: r.sale_date,
    unchin: r.fare,
    seikyuDate: r.billing_date ?? '',
    subcontractorCode: r.subcontractor_code,
    itemCode: r.item_code,
    itemName: r.item_name,
  }))
}

/**
 * 一括調整明細 (品名N「※請求一括調整明細※」「※傭車一括調整明細※」) か (純粋)。
 * 運送実体の無い調整行なので、サーチャージ明細・集計から除外する判定に使う。
 * 注意: 「燃料油価格変動調整金」「燃料調整金」(= 実サーチャージ請求行) や「端数調整」は
 * "調整明細" を含まないため除外されない。
 */
export function isAdjustmentRow(r: IchibanSurchargeRow): boolean {
  return (r.item_name ?? '').includes('調整明細')
}

/**
 * 傭車先C から自車/傭車区分を返す (純粋)。
 * '000000' (6 桁ゼロ) → 自車、空/undefined (producer 旧版) → '—'、それ以外 → 傭車。
 */
export function ownershipLabel(subcontractorCode?: string): '自車' | '傭車' | '—' {
  if (subcontractorCode === undefined || subcontractorCode === '') return '—'
  return subcontractorCode === '000000' ? '自車' : '傭車'
}
