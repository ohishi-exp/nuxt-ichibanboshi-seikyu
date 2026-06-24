// 一番星 /api/surcharge/base のレスポンス行を計算エンジンの MeisaiRow に写像する純粋関数。
// Refs #11 (#5 確認 UI)
//
// 一番星 (rust-ichibanboshi) の SurchargeRow は county 正規化済み・運賃合算済みで返るので、
// ここでは field 名を MeisaiRow に合わせ、null の請求日を空文字に正規化するだけ。

import type { MeisaiRow, SurchargeResult } from './surcharge'

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
  /** 車輌C (車番。例: 8504)。producer 旧版では欠落し得るため optional */
  vehicle_number?: string
  /** 実額サーチャージ (割増C='19' = 燃料ｻｰﾁｬｰｼﾞ)。producer (#26) 以降で返る。旧版は欠落 */
  fuel_surcharge?: number
  /** 行 ID = 管理年月日+管理C。producer (#27) 以降で返る。skip 永続化キー。旧版は欠落 */
  row_id?: string
  /** 入力担当C (入力者)。producer (#12 入力者対応) 以降で返る。旧版は欠落 (undefined) */
  input_staff_code?: string
  /** 入力者氏名 (社員ﾏｽﾀ.社員N)。producer (#29) 以降で返る。未マップ/旧版は空 or 欠落 */
  input_staff_name?: string
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
    vehicleNumber: r.vehicle_number,
    vehicleName: r.vehicle_name,
    actualSurcharge: r.fuel_surcharge ?? 0,
    rowId: r.row_id,
    inputStaffCode: r.input_staff_code,
    inputStaffName: r.input_staff_name,
  }))
}

/**
 * 1 行の「計算 vs 実額(割増C=19)」照合結果 (純粋)。Refs #63
 * - computed: 計算サーチャージ (届出書方式、SurchargeResult.amount。status!=='ok' は 0)
 * - actual:   実額サーチャージ (producer の fuel_surcharge = 割増C='19')
 * - diff:     computed - actual (正 = 未計上で今後請求すべき額 / 負 = 過計上)
 * - match:    computed === actual (完全一致)
 */
export interface RowReconcile {
  computed: number
  actual: number
  diff: number
  match: boolean
}

export function reconcileRow(result: SurchargeResult): RowReconcile {
  const computed = result.status === 'ok' ? result.amount : 0
  const actual = result.row.actualSurcharge ?? 0
  const diff = computed - actual
  return { computed, actual, diff, match: diff === 0 }
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
