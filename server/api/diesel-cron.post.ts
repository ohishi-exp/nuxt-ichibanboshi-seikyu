import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureDieselSchema } from '../../src/diesel-price-db'
import { ensureDieselImportStateSchema } from '../../src/diesel-import-state'
import { runDieselImportCron } from '../utils/diesel-cron'
import { buildNotifyFn, type LineworksEnv } from '../utils/lineworks-notify'

// POST /api/diesel-cron — cron と同じオーケストレーションを手動実行する (管理者限定)。
// cron 配線 (水曜 14:05/15/25 JST) を待たずに「取込 + LINE WORKS 通知」を検証するための入口。
// 取得後不要 (dedup) も同じく効くので、新ファイルが無ければ skipped_no_new を返す。
// 強制再取込が要る場合は POST /api/diesel-import (dedup なし) を使う。Refs #11 (#2)
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureDieselSchema(db)
  await ensureDieselImportStateSchema(db)
  const env = (event.context.cloudflare as { env?: LineworksEnv } | undefined)?.env
  const notify = await buildNotifyFn(env)
  return runDieselImportCron(db, { notify })
})
