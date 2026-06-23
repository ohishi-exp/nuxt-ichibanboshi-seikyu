// 軽油価格 自動取込の cron オーケストレーター。Refs #11 (#2)
//
// 「取得後実施不要」を満たすため、最新の週次ファイルの公表日キー (YYMMDD) を
// diesel_import_state に保存し、最新キーが保存済みと同じなら skip する。
// = 公表日 (水曜 14:00) に 14:05/14:15/14:25 と 3 回叩いても、新ファイルが出た 1 回だけ
//   取込 + 通知し、残りは no-op。新ファイル未公表なら全 skip。
//
// 取込成功後に notify (LINE WORKS bot 等) を呼ぶ。notify は fail-open。
// 依存は全て注入可能にしてあり、network 非依存で単体テストできる。

import type { D1Database } from '../../src/distance-db'
// diesel-import は xlsx に依存するので value import しない (= 単体テストで xlsx ロードを避ける)。
// 既定の resolveUrl/importUrl は dep 未注入時のみ dynamic import で解決する。
import type { DieselImportResult } from './diesel-import'
import { getLastImportKey, setLastImportKey } from '../../src/diesel-import-state'

export type CronStatus = 'imported' | 'skipped_no_new' | 'resolve_failed' | 'import_failed'

export interface CronResult {
  status: CronStatus
  sourceKey?: string
  sourceUrl?: string
  months?: number
  latestMonth?: string
  latestPrice?: number
  reason?: string
  notified?: boolean
}

export interface CronDeps {
  recentMonths?: number
  now?: Date
  resolveUrl?: () => Promise<
    { ok: true; url: string; key: string } | { ok: false; reason: string }
  >
  importUrl?: (
    db: D1Database,
    url: string,
    opts: { recentMonths?: number },
  ) => Promise<DieselImportResult>
  loadLastKey?: (db: D1Database) => Promise<string | null>
  saveKey?: (db: D1Database, key: string, runAt: string) => Promise<void>
  /** 取込成功後の通知。throw しても orchestrator は notified:false で続行 */
  notify?: (text: string) => Promise<void>
}

/** 通知本文 (純粋) */
export function buildNotifyText(
  latestMonth: string | undefined,
  latestPrice: number | undefined,
  months: number | undefined,
  sourceUrl: string | undefined,
): string {
  return [
    '【一番星 燃料サーチャージ】軽油価格マスタを自動更新しました',
    `最新: ${latestMonth ?? '?'} = ${latestPrice ?? '?'} 円/L (直近${months ?? '?'}ヶ月取込)`,
    sourceUrl ? `出典: ${sourceUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function runDieselImportCron(db: D1Database, deps: CronDeps = {}): Promise<CronResult> {
  const resolveUrl =
    deps.resolveUrl ?? (async () => (await import('./diesel-import')).resolveLatestWeeklyXlsxUrl())
  const importUrl =
    deps.importUrl ??
    (async (d: D1Database, url: string, opts: { recentMonths?: number }) =>
      (await import('./diesel-import')).importDieselFromXlsxUrl(d, url, opts))
  const loadLastKey = deps.loadLastKey ?? getLastImportKey
  const saveKey = deps.saveKey ?? setLastImportKey
  const now = deps.now ?? new Date()

  const resolved = await resolveUrl()
  if (!resolved.ok) return { status: 'resolve_failed', reason: resolved.reason }

  const lastKey = await loadLastKey(db)
  if (lastKey && lastKey === resolved.key) {
    return { status: 'skipped_no_new', sourceKey: resolved.key, sourceUrl: resolved.url }
  }

  const result = await importUrl(db, resolved.url, { recentMonths: deps.recentMonths })
  if (!result.ok) {
    return {
      status: 'import_failed',
      reason: result.reason,
      sourceUrl: resolved.url,
      sourceKey: resolved.key,
    }
  }

  await saveKey(db, resolved.key, now.toISOString())

  let notified = false
  if (deps.notify) {
    try {
      await deps.notify(
        buildNotifyText(result.latestMonth, result.latestPrice, result.months, result.sourceUrl),
      )
      notified = true
    } catch {
      notified = false
    }
  }

  return {
    status: 'imported',
    sourceKey: resolved.key,
    sourceUrl: resolved.url,
    months: result.months,
    latestMonth: result.latestMonth,
    latestPrice: result.latestPrice,
    notified,
  }
}
