// 「計算しない (skip) 行」の D1 アクセス。Refs #63
//
// 締め日別 取引先の照合画面で、特定の運転日報明細行を計算対象から外す (skip) 操作を
// 永続化する。キーは producer (rust-ichibanboshi#27) が返す行 ID (= 管理年月日+管理C)。
// 内容ハッシュは重複行があり一意にならないため使えない (#24 / #27 参照)。
// 値カラム (運賃/金額) に依存しない安定キーなので、行が編集されても skip は残る。

import type { D1Database } from './distance-db'

export interface SurchargeSkip {
  rowId: string
  /** 監査・表示用メタ (任意)。計算には使わない */
  customerCode?: string
  saleDate?: string
  billingDate?: string
  note?: string
}

export const SURCHARGE_SKIPS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS surcharge_skips (
    row_id TEXT PRIMARY KEY,
    customer_code TEXT,
    sale_date TEXT,
    billing_date TEXT,
    note TEXT,
    created_at TEXT
  )`,
]

export async function ensureSurchargeSkipsSchema(db: D1Database): Promise<void> {
  for (const ddl of SURCHARGE_SKIPS_DDL) {
    await db.prepare(ddl).run()
  }
}

interface SkipRow {
  row_id: string
}

/** skip 登録済みの行 ID 集合を返す (計算対象から外す行) */
export async function loadSkippedRowIds(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare('SELECT row_id FROM surcharge_skips ORDER BY row_id')
    .all<SkipRow>()
  return res.results.map((r) => r.row_id)
}

/** 行を skip 登録 (upsert)。メタ (得意先/売上日/請求日/メモ) は後勝ち更新 */
export async function addSurchargeSkip(
  db: D1Database,
  skip: SurchargeSkip,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO surcharge_skips (row_id, customer_code, sale_date, billing_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(row_id) DO UPDATE SET
         customer_code = excluded.customer_code,
         sale_date = excluded.sale_date,
         billing_date = excluded.billing_date,
         note = excluded.note`,
    )
    .bind(
      skip.rowId,
      skip.customerCode ?? null,
      skip.saleDate ?? null,
      skip.billingDate ?? null,
      skip.note ?? null,
      createdAt,
    )
    .run()
}

/** 行の skip を解除 (計算対象に戻す) */
export async function deleteSurchargeSkip(db: D1Database, rowId: string): Promise<void> {
  await db.prepare('DELETE FROM surcharge_skips WHERE row_id = ?').bind(rowId).run()
}
