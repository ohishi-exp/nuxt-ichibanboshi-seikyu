import { describe, it, expect, vi } from 'vitest'
import { runDieselImportCron, buildNotifyText, type CronDeps } from '../server/utils/diesel-cron'
import type { D1Database } from '../src/distance-db'
import type { DieselImportResult } from '../server/utils/diesel-import'

// db は注入した loadLastKey/saveKey/importUrl 経由でしか使わないのでダミーで良い
const db = {} as D1Database

const okImport: DieselImportResult = {
  ok: true,
  sourceUrl: 'https://e/260617s5.xlsx',
  sourceKey: '260617',
  months: 24,
  latestMonth: '2026-06',
  latestPrice: 151,
}

function baseDeps(over: Partial<CronDeps> = {}): CronDeps {
  return {
    resolveUrl: async () => ({ ok: true, url: 'https://e/260617s5.xlsx', key: '260617' }),
    importUrl: async () => okImport,
    loadLastKey: async () => null,
    saveKey: async () => {},
    ...over,
  }
}

describe('buildNotifyText', () => {
  it('最新月・価格・月数・出典を含む', () => {
    const t = buildNotifyText('2026-06', 151, 24, 'https://e/x.xlsx')
    expect(t).toContain('2026-06 = 151 円/L')
    expect(t).toContain('直近24ヶ月')
    expect(t).toContain('出典: https://e/x.xlsx')
  })
  it('sourceUrl 無しは出典行を省く', () => {
    expect(buildNotifyText('2026-06', 151, 24, undefined)).not.toContain('出典')
  })
})

describe('runDieselImportCron', () => {
  it('resolve 失敗 → resolve_failed', async () => {
    const res = await runDieselImportCron(
      db,
      baseDeps({ resolveUrl: async () => ({ ok: false, reason: 'page 503' }) }),
    )
    expect(res.status).toBe('resolve_failed')
    expect(res.reason).toBe('page 503')
  })

  it('保存済みキーと同じ → skipped_no_new (取得後不要)', async () => {
    const importUrl = vi.fn(async () => okImport)
    const res = await runDieselImportCron(
      db,
      baseDeps({ loadLastKey: async () => '260617', importUrl }),
    )
    expect(res.status).toBe('skipped_no_new')
    expect(res.sourceKey).toBe('260617')
    expect(importUrl).not.toHaveBeenCalled() // 重い xlsx 取得を踏まない
  })

  it('新キー → 取込 + キー保存 + 通知', async () => {
    const saveKey = vi.fn(async () => {})
    const notify = vi.fn(async () => {})
    const res = await runDieselImportCron(
      db,
      baseDeps({ loadLastKey: async () => '260610', saveKey, notify, now: new Date('2026-06-17T05:05:00Z') }),
    )
    expect(res.status).toBe('imported')
    expect(res.latestMonth).toBe('2026-06')
    expect(res.notified).toBe(true)
    expect(saveKey).toHaveBeenCalledWith(db, '260617', '2026-06-17T05:05:00.000Z')
    expect(notify).toHaveBeenCalledOnce()
  })

  it('lastKey が null (初回) でも取込む', async () => {
    const res = await runDieselImportCron(db, baseDeps({ loadLastKey: async () => null }))
    expect(res.status).toBe('imported')
  })

  it('取込失敗 → import_failed (キー保存しない)', async () => {
    const saveKey = vi.fn(async () => {})
    const res = await runDieselImportCron(
      db,
      baseDeps({ importUrl: async () => ({ ok: false, reason: 'xlsx 502' }), saveKey }),
    )
    expect(res.status).toBe('import_failed')
    expect(res.reason).toBe('xlsx 502')
    expect(saveKey).not.toHaveBeenCalled()
  })

  it('notify 未設定なら notified:false で取込は成功', async () => {
    const res = await runDieselImportCron(db, baseDeps({ notify: undefined }))
    expect(res.status).toBe('imported')
    expect(res.notified).toBe(false)
  })

  it('notify が throw しても imported は維持 (notified:false)', async () => {
    const res = await runDieselImportCron(
      db,
      baseDeps({
        notify: async () => {
          throw new Error('lineworks down')
        },
      }),
    )
    expect(res.status).toBe('imported')
    expect(res.notified).toBe(false)
  })
})
