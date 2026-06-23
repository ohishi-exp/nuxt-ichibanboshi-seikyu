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
