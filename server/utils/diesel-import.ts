import * as XLSX from 'xlsx'
import type { D1Database } from '../../src/distance-db'
import {
  ENECHO_RESULTS_URL,
  extractDataFileLinks,
  pickLatestWeeklyXlsxUrl,
  weeklyKeyFromUrl,
} from './diesel-fetch'
import {
  KEIYU_SHEET_NAME,
  extractMonthlyDieselAverages,
  extractWeeklyDieselPrices,
} from '../../src/diesel-xlsx'
import { upsertManyDieselEntries } from '../../src/diesel-price-db'
import { ensureDieselWeeklySchema, upsertManyDieselWeekly } from '../../src/diesel-weekly-db'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface DieselImportResult {
  ok: boolean
  reason?: string
  sourceUrl?: string
  /** 取込んだ週次ファイルの公表日キー (YYMMDD) */
  sourceKey?: string
  months?: number
  latestMonth?: string
  latestPrice?: number
  /** 週次 全国平均を保存した件数 (検算表示の元データ)。0 は週次未保存 */
  weeklyWritten?: number
  /** 週次保存が失敗した時のエラー文言 (月次取込は成立済み)。診断用 */
  weeklyError?: string
}

/** 結果ページから最新の週次 xlsx URL + 公表日キー (YYMMDD) を解決する */
export async function resolveLatestWeeklyXlsxUrl(): Promise<
  { ok: true; url: string; key: string } | { ok: false; reason: string }
> {
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
  const url = pickLatestWeeklyXlsxUrl(extractDataFileLinks(html, ENECHO_RESULTS_URL))
  if (!url) return { ok: false, reason: '週次ファイル (YYMMDDs5.xlsx) のリンクが見つかりません' }
  const key = weeklyKeyFromUrl(url) ?? ''
  return { ok: true, url, key }
}

/** 指定の週次 xlsx URL を取得し、軽油シートの全国平均を月次平均で diesel_price へ upsert する */
export async function importDieselFromXlsxUrl(
  db: D1Database,
  sourceUrl: string,
  opts: { recentMonths?: number } = {},
): Promise<DieselImportResult> {
  const sourceKey = weeklyKeyFromUrl(sourceUrl) ?? undefined
  let aoa: unknown[][]
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'ja,en;q=0.8' },
    })
    if (!res.ok) return { ok: false, reason: `xlsx ${res.status}`, sourceUrl, sourceKey }
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' })
    const ws = wb.Sheets[KEIYU_SHEET_NAME]
    if (!ws) return { ok: false, reason: `「${KEIYU_SHEET_NAME}」シートがありません`, sourceUrl, sourceKey }
    aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  } catch (e: unknown) {
    return {
      ok: false,
      reason: `xlsx parse failed: ${e instanceof Error ? e.message : e}`,
      sourceUrl,
      sourceKey,
    }
  }

  const recentMonths = opts.recentMonths ?? 24
  const entries = extractMonthlyDieselAverages(aoa, { recentMonths })
  if (entries.length === 0) {
    return { ok: false, reason: '軽油の月次データを抽出できません', sourceUrl, sourceKey }
  }
  await upsertManyDieselEntries(db, entries)

  // 検算用に週次 全国平均も保存 (月次平均の根拠)。失敗しても月次取込は成立済みなので
  // throw はしないが、件数とエラーを結果に載せて診断可能にする (silent fail にしない)。
  let weeklyWritten = 0
  let weeklyError: string | undefined
  try {
    const weekly = extractWeeklyDieselPrices(aoa, { recentMonths })
    await ensureDieselWeeklySchema(db)
    await upsertManyDieselWeekly(db, weekly)
    weeklyWritten = weekly.length
  } catch (e: unknown) {
    weeklyError = e instanceof Error ? e.message : String(e)
    console.warn('diesel weekly upsert failed:', weeklyError)
  }

  const latest = entries[entries.length - 1]
  return {
    ok: true,
    sourceUrl,
    sourceKey,
    months: entries.length,
    latestMonth: latest?.month,
    latestPrice: latest?.price,
    weeklyWritten,
    weeklyError,
  }
}

/**
 * 資源エネルギー庁 結果ページ → 最新の給油所小売週次 xlsx (YYMMDDs5.xlsx) → 軽油シートの
 * 全国平均を月次平均に集約 → diesel_price へ直近 N ヶ月 upsert する。Refs #11 (#2)
 *
 * 全置換ではなく upsert なので、手入力した月は保持される。失敗は throw せず reason で返す
 * (cron/手動とも呼び出し側で扱う)。手動取込ボタン用に常に取込む (重複判定なし)。
 */
export async function importDieselFromEnecho(
  db: D1Database,
  opts: { recentMonths?: number } = {},
): Promise<DieselImportResult> {
  const resolved = await resolveLatestWeeklyXlsxUrl()
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  return importDieselFromXlsxUrl(db, resolved.url, opts)
}
