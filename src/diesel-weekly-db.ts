// 軽油価格の週次全国平均 (検算用) の D1 アクセス。Refs #11 (#2)
//
// diesel_price は月次平均 (計算エンジンが使う正)。その平均が妥当か人が検算できるよう、
// 取込時に元の週次 全国平均も保存する。survey_date を PK にした単純な upsert。

import type { D1Database, D1PreparedStatement } from './distance-db'
import type { WeeklyDieselPrice } from './diesel-xlsx'

export const DIESEL_WEEKLY_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS diesel_price_weekly (
    survey_date TEXT PRIMARY KEY,
    month TEXT NOT NULL,
    price REAL NOT NULL
  )`,
]

export async function ensureDieselWeeklySchema(db: D1Database): Promise<void> {
  for (const ddl of DIESEL_WEEKLY_DDL) {
    await db.prepare(ddl).run()
  }
}

interface WeeklyRow {
  survey_date: string
  month: string
  price: number
}

/** 週次レコードを調査日昇順で読む */
export async function loadDieselWeekly(db: D1Database): Promise<WeeklyDieselPrice[]> {
  const res = await db
    .prepare('SELECT survey_date, month, price FROM diesel_price_weekly ORDER BY survey_date')
    .all<WeeklyRow>()
  return res.results.map((r) => ({ date: r.survey_date, month: r.month, price: r.price }))
}

// D1 の bound parameter 上限を避けるため 1 INSERT あたりの行数を抑える (3 列)。
const INSERT_CHUNK = 30

/** 週次レコードを upsert する (survey_date PK で後勝ち)。対象外の週は保持 */
export async function upsertManyDieselWeekly(
  db: D1Database,
  rows: WeeklyDieselPrice[],
): Promise<void> {
  if (rows.length === 0) return
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?, ?, ?)').join(', ')
    const binds: unknown[] = []
    for (const w of chunk) binds.push(w.date, w.month, w.price)
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO diesel_price_weekly (survey_date, month, price) VALUES ${placeholders}`,
        )
        .bind(...binds),
    )
  }
  await db.batch(stmts)
}
