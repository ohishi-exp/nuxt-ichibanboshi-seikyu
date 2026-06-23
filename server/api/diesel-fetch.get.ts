import { requireAdmin } from '../utils/auth'
import {
  ENECHO_RESULTS_URL,
  isAllowedSourceUrl,
  extractDataFileLinks,
} from '../utils/diesel-fetch'

// GET /api/diesel-fetch?url=... — 経産省 (資源エネルギー庁) 公表ページ/ファイルへ
// Worker から到達できるか確かめる probe。管理者限定。Refs #11 (#2 月次平均 自動取得)
//
// Phase 1 (probe): browser-like UA で fetch し、status / content-type / size を返す。
// HTML なら .xlsx/.xls/.csv link を抽出して返す (月次平均ファイル URL の発見)。
// SSRF 防止のため取得先は enecho.meti.go.jp / oil-info.ieej.or.jp に限定。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const url = (typeof q.url === 'string' && q.url ? q.url : ENECHO_RESULTS_URL).trim()
  if (!isAllowedSourceUrl(url)) {
    throw createError({
      statusCode: 400,
      statusMessage: '許可されていない取得先です (enecho.meti.go.jp / oil-info.ieej.or.jp のみ)',
    })
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        // WAF が素の fetch を弾くため browser 相当の UA / Accept を付ける
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8',
      },
    })
  } catch (e: unknown) {
    return {
      ok: false,
      reason: 'connect_failed',
      message: e instanceof Error ? e.message : String(e),
      url,
    }
  }

  const contentType = res.headers.get('content-type') ?? ''
  const buf = await res.arrayBuffer()
  const bytes = buf.byteLength

  // HTML ならデータファイル link を抽出 (月次平均 xlsx/csv の URL 発見)
  let links: string[] = []
  if (contentType.includes('html') || contentType.includes('text')) {
    const html = new TextDecoder().decode(buf)
    links = extractDataFileLinks(html, url)
  }

  return {
    ok: res.ok,
    status: res.status,
    contentType,
    bytes,
    url,
    links, // .xlsx/.xls/.csv の絶対 URL 候補
  }
})
