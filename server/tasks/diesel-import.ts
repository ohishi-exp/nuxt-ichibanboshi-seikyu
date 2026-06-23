// nitro scheduled task: 経産省 軽油価格を最新週次から自動取込 + LINE WORKS 通知。Refs #11 (#2)
//
// nuxt.config の scheduledTasks (`5,15,25 5 * * 3` = 水曜 14:05/14:15/14:25 JST) で起動する。
// 取得後不要 (dedup) により、新ファイルが出た 1 回だけ取込 + 通知し残りは no-op。
//
// Cloudflare Workers の binding は scheduled context では H3 event 経由で取れないため、
// CF ネイティブの `cloudflare:workers` の `env` から DB / LINE WORKS 設定を読む
// (compatibility_date 2025-07-15 で利用可。node/vitest では読めないので task 本体は
//  単体テスト対象外、ロジックは diesel-cron.ts 側でテスト済み)。
import { env as cfEnv } from 'cloudflare:workers'
import type { D1Database } from '../../src/distance-db'
import { ensureDieselSchema } from '../../src/diesel-price-db'
import { ensureDieselImportStateSchema } from '../../src/diesel-import-state'
import { runDieselImportCron } from '../utils/diesel-cron'
import { buildNotifyFn, type LineworksEnv } from '../utils/lineworks-notify'

export default defineTask({
  meta: {
    name: 'diesel-import',
    description: '経産省 軽油価格を最新週次から自動取込 + LINE WORKS 通知',
  },
  async run() {
    const env = cfEnv as unknown as ({ DB?: D1Database } & LineworksEnv)
    const db = env.DB
    if (!db) {
      console.warn('[diesel:import] DB binding 未設定のため skip')
      return { result: { status: 'no_db' } }
    }
    await ensureDieselSchema(db)
    await ensureDieselImportStateSchema(db)
    const notify = await buildNotifyFn(env)
    const result = await runDieselImportCron(db, { notify })
    console.log('[diesel:import]', JSON.stringify(result))
    return { result }
  },
})
