import * as XLSX from 'xlsx'
import { requireAdmin } from '../utils/auth'
import { isAllowedSourceUrl } from '../utils/diesel-fetch'

// GET /api/diesel-xlsx-inspect?url=... — 経産省公表 xlsx を Worker から取得し構造を返す probe。
// 管理者限定。Refs #11 (#2 自動取得 Phase 2)。全国平均軽油価格のセル位置特定用。
//
// 各シートの先頭 ~40 行を文字列行列で返し、さらに「軽油 / 全国 / 価格」を含むセルの
// 位置 (sheet/row/col/value) を matches に列挙する。SSRF 防止で取得先は allowlist 限定。
const MAX_ROWS = 40
const MAX_COLS = 20
const NEEDLES = ['軽油', '全国', '価格', '単位']

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const q = getQuery(event)
  const url = typeof q.url === 'string' ? q.url.trim() : ''
  if (!url || !isAllowedSourceUrl(url)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url を allowlist host (enecho.meti.go.jp / oil-info.ieej.or.jp) で指定してください',
    })
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'ja,en;q=0.8',
      },
    })
  } catch (e: unknown) {
    return { ok: false, reason: 'connect_failed', message: e instanceof Error ? e.message : String(e), url }
  }
  if (!res.ok) {
    return { ok: false, reason: 'upstream', status: res.status, url }
  }

  const buf = new Uint8Array(await res.arrayBuffer())
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array' })
  } catch (e: unknown) {
    return { ok: false, reason: 'parse_failed', message: e instanceof Error ? e.message : String(e), url }
  }

  const matches: { sheet: string; row: number; col: number; value: string }[] = []
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    if (!ws) return { name, rows: [] as string[][] }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
    const rows: string[][] = []
    for (let r = 0; r < Math.min(aoa.length, MAX_ROWS); r++) {
      const row = aoa[r] ?? []
      const cells: string[] = []
      for (let c = 0; c < Math.min(row.length, MAX_COLS); c++) {
        const v = row[c]
        const s = v === null || v === undefined ? '' : String(v).trim()
        cells.push(s)
        if (s && NEEDLES.some((n) => s.includes(n)) && matches.length < 60) {
          matches.push({ sheet: name, row: r, col: c, value: s })
        }
      }
      rows.push(cells)
    }
    return { name, dimension: ws['!ref'] ?? '', rows }
  })

  return { ok: true, url, sheetNames: wb.SheetNames, matches, sheets }
})
