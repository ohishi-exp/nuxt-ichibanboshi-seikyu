// 経産省 (資源エネルギー庁) / 石油情報センター 公表の軽油価格を取得するための補助。Refs #11 (#2 自動取得)
//
// まず「Worker から公表ページ/ファイルに到達できるか」を確かめる probe を提供する
// (CF Worker cron probe 先行)。到達できれば月次平均値を parse して diesel_price に
// upsert する Phase 2 へ進む。
//
// SSRF 防止のため、取得先は経産省 / 石油情報センターの host allowlist に限定する。

/** 取得先 host allowlist (SSRF 防止)。経産省公表 + 石油情報センター月次平均 */
const ALLOWED_HOSTS: readonly string[] = [
  'www.enecho.meti.go.jp',
  'enecho.meti.go.jp',
  'oil-info.ieej.or.jp',
]

/** 既定の取得元 (資源エネルギー庁 石油製品価格調査 結果ページ)。月次平均もここから辿る */
export const ENECHO_RESULTS_URL =
  'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html'

/** https かつ allowlist host のみ true (SSRF 防止)。それ以外は false */
export function isAllowedSourceUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return ALLOWED_HOSTS.includes(u.hostname)
}

/**
 * HTML から データファイル (.xlsx / .xls / .csv) への link を絶対 URL で抽出する (純粋)。
 * 相対 href は baseUrl で解決する。重複は除く。月次平均ファイルの URL 発見に使う。
 */
export function extractDataFileLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  const re = /href\s*=\s*["']([^"']+\.(?:xlsx|xls|csv))["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]
    if (href === undefined) continue
    try {
      out.add(new URL(href, baseUrl).toString())
    } catch {
      // 解決不能な href は無視
    }
  }
  return [...out]
}

/**
 * データファイル link 群から「給油所小売 週次 全履歴ファイル」(YYMMDDs5.xlsx) の最新を選ぶ。
 * 軽油など全 product の全国平均週次を含む累積ファイル。ファイル名の YYMMDD (公表日) が
 * 最大のものを返す。該当が無ければ null。
 */
export function pickLatestWeeklyXlsxUrl(links: string[]): string | null {
  let best: { url: string; key: string } | null = null
  const re = /\/(\d{6})s5\.xlsx$/i
  for (const url of links) {
    const m = re.exec(url)
    if (!m || m[1] === undefined) continue
    const key = m[1]
    if (best === null || key > best.key) best = { url, key }
  }
  return best?.url ?? null
}

/** 公表予定日 1 件 (例: 6月24日(水)14:00 → date='2026-06-24', time='14:00', weekday='水') */
export interface PublicationDate {
  /** YYYY-MM-DD (JST。年はページに無いので now から補完) */
  date: string
  /** HH:MM (JST、公表時刻) */
  time: string
  /** 曜日 1 文字 (日月火水木金土) */
  weekday: string
}

/**
 * 結果ページ HTML の「公表予定日」セクションから予定日時を抽出する (純粋)。
 * 例: 「6月24日（水）14：00」。年はテキストに無いので `now` (既定は現在) を基準に補完し、
 * 月が現在月より小さい場合のみ翌年扱いにする (12月→1月の年跨ぎ補正)。日付昇順で返す。
 */
export function extractPublicationSchedule(html: string, now: Date = new Date()): PublicationDate[] {
  // 全角括弧/コロン/数字を NFKC で半角化してから素直に match する
  const text = html.normalize('NFKC')
  const re = /(\d{1,2})月\s*(\d{1,2})日\s*\(\s*([日月火水木金土])\s*\)\s*(\d{1,2}):(\d{2})/g
  const curYear = now.getUTCFullYear()
  const curMonth = now.getUTCMonth() + 1
  const seen = new Set<string>()
  const out: PublicationDate[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const mon = Number(m[1])
    const day = Number(m[2])
    const weekday = m[3] as string
    const hh = Number(m[4])
    const mm = Number(m[5])
    if (mon < 1 || mon > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) continue
    const year = mon < curMonth ? curYear + 1 : curYear
    const date = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    const key = `${date} ${time}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ date, time, weekday })
  }
  out.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  return out
}
