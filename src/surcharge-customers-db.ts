// サーチャージマスタ (= サーチャージ対象として登録する取引先) の D1 アクセス。Refs #11
//
// 取引先コードを主キーに、対象取引先を登録/削除する。締め日別の確認画面で
// 「登録有無」を表示し、その場で追加/削除する。

import type { D1Database } from './distance-db'

export interface SurchargeCustomer {
  customerCode: string
  customerName: string
}

export const SURCHARGE_CUSTOMERS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS surcharge_customers (
    customer_code TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL DEFAULT '',
    created_at TEXT
  )`,
]

export async function ensureSurchargeCustomersSchema(db: D1Database): Promise<void> {
  for (const ddl of SURCHARGE_CUSTOMERS_DDL) {
    await db.prepare(ddl).run()
  }
}

interface CustomerRow {
  customer_code: string
  customer_name: string
}

/** 登録済みのサーチャージ対象取引先を取引先コード順で返す */
export async function loadSurchargeCustomers(db: D1Database): Promise<SurchargeCustomer[]> {
  const res = await db
    .prepare('SELECT customer_code, customer_name FROM surcharge_customers ORDER BY customer_code')
    .all<CustomerRow>()
  return res.results.map((r) => ({ customerCode: r.customer_code, customerName: r.customer_name }))
}

/** 取引先をサーチャージ対象に登録 (upsert)。名称は後勝ち更新 */
export async function addSurchargeCustomer(
  db: D1Database,
  customer: SurchargeCustomer,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO surcharge_customers (customer_code, customer_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(customer_code) DO UPDATE SET customer_name = excluded.customer_name`,
    )
    .bind(customer.customerCode, customer.customerName, createdAt)
    .run()
}

/** 取引先をサーチャージ対象から削除 */
export async function deleteSurchargeCustomer(db: D1Database, customerCode: string): Promise<void> {
  await db
    .prepare('DELETE FROM surcharge_customers WHERE customer_code = ?')
    .bind(customerCode)
    .run()
}
