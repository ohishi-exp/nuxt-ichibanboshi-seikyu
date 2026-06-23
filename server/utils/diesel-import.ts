import * as XLSX from 'xlsx'
import type { D1Database } from '../../src/distance-db'
import {
  ENECHO_RESULTS_URL,
  extractDataFileLinks,
  pickLatestWeeklyXlsxUrl,
} from './diesel-fetch'
import { KEIYU_SHEET_NAME, extractMonthlyDieselAverages } from '../../src/diesel-xlsx'
import { upsertManyDieselEntries } from '../../src/diesel-price-db'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface DieselImportResult {
  ok: boolean
  reason?: string
  sourceUrl?: string
  months?: number
  latestMonth?: string
  latestPrice?: number
}

/**
 * 資源エネルギー庁 結果ページ → 最新の給油所小売週次 xlsx (YYMMDDs5.xlsx) → 軽油シートの
 * 全国平均を月次平均に集約 → diesel_price へ直近 N ヶ月 upsert する。Refs #11 (#2)
 *
 * 全置換ではなく upsert なので、手入力した月は保持される。失敗は throw せず reason で返す
 * (cron/手動とも呼び出し側で扱う)。
 */
export async function importDieselFromEnecho(
  db: D1Database,
  opts: { recentMonths?: number } = {},
): Promise<DieselImportResult> {
  // 1) 結果ページから最新の週次 xlsx URL を見つける
  let html: string
  try {
    const res = await fetch(ENECHO_RESULTS_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'ja,en;q=0.8' },
    })
    if (!res.ok) return { ok: false, reason: `results page ${res.status}` }
    html = await res.text()
  } catch (e: unknown) {
    return { ok: false, reason: `results fetch failed: ${e instanceof Error ? e.message : e}` }
  }
  const sourceUrl = pickLatestWeeklyXlsxUrl(extractDataFileLinks(html, ENECHO_RESULTS_URL))
  if (!sourceUrl) return { ok: false, reason: '週次ファイル (YYMMDDs5.xlsx) のリンクが見つかりません' }

  // 2) xlsx を取得して軽油シートを parse
  let aoa: unknown[][]
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'ja,en;q=0.8' },
    })
    if (!res.ok) return { ok: false, reason: `xlsx ${res.status}`, sourceUrl }
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' })
    const ws = wb.Sheets[KEIYU_SHEET_NAME]
    if (!ws) return { ok: false, reason: `「${KEIYU_SHEET_NAME}」シートがありません`, sourceUrl }
    aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  } catch (e: unknown) {
    return { ok: false, reason: `xlsx parse failed: ${e instanceof Error ? e.message : e}`, sourceUrl }
  }

  // 3) 月次平均 → upsert (直近 N ヶ月、既定 24)
  const entries = extractMonthlyDieselAverages(aoa, { recentMonths: opts.recentMonths ?? 24 })
  if (entries.length === 0) return { ok: false, reason: '軽油の月次データを抽出できません', sourceUrl }
  await upsertManyDieselEntries(db, entries)

  const latest = entries[entries.length - 1]
  return {
    ok: true,
    sourceUrl,
    months: entries.length,
    latestMonth: latest?.month,
    latestPrice: latest?.price,
  }
}
