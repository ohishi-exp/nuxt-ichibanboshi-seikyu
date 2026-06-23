import { describe, it, expect } from 'vitest'
import {
  isAllowedSourceUrl,
  extractDataFileLinks,
  extractPublicationSchedule,
  pickLatestWeeklyXlsxUrl,
  weeklyKeyFromUrl,
  ENECHO_RESULTS_URL,
} from '../server/utils/diesel-fetch'

describe('isAllowedSourceUrl (SSRF 防止 host allowlist)', () => {
  it('enecho / 石油情報センター の https は許可', () => {
    expect(isAllowedSourceUrl('https://www.enecho.meti.go.jp/statistics/x.html')).toBe(true)
    expect(isAllowedSourceUrl('https://enecho.meti.go.jp/a.xlsx')).toBe(true)
    expect(isAllowedSourceUrl('https://oil-info.ieej.or.jp/price/x.html')).toBe(true)
    expect(isAllowedSourceUrl(ENECHO_RESULTS_URL)).toBe(true)
  })
  it('http / 別 host / 不正 URL は拒否', () => {
    expect(isAllowedSourceUrl('http://www.enecho.meti.go.jp/x')).toBe(false) // 非 https
    expect(isAllowedSourceUrl('https://evil.example.com/x')).toBe(false)
    expect(isAllowedSourceUrl('https://meti.go.jp.evil.com/x')).toBe(false)
    expect(isAllowedSourceUrl('not a url')).toBe(false)
    expect(isAllowedSourceUrl('https://169.254.169.254/latest/meta-data')).toBe(false)
  })
})

describe('extractDataFileLinks', () => {
  const base = 'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/results.html'

  it('xlsx / xls / csv link を絶対 URL で抽出 (相対も解決)', () => {
    const html = `
      <a href="./excel/result_2026.xlsx">月次</a>
      <a href="/statistics/x/old.xls">旧</a>
      <a href="https://oil-info.ieej.or.jp/data/m.csv">月次平均</a>
      <a href="other.html">無関係</a>
    `
    const links = extractDataFileLinks(html, base)
    expect(links).toContain(
      'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/excel/result_2026.xlsx',
    )
    expect(links).toContain('https://www.enecho.meti.go.jp/statistics/x/old.xls')
    expect(links).toContain('https://oil-info.ieej.or.jp/data/m.csv')
    expect(links.some((l) => l.endsWith('other.html'))).toBe(false)
  })

  it('大文字拡張子・シングルクォートも拾う / 重複除去', () => {
    const html = `<a href='A.XLSX'>x</a><a href="A.XLSX">dup</a>`
    const links = extractDataFileLinks(html, base)
    expect(links).toHaveLength(1)
  })

  it('該当なしは空配列', () => {
    expect(extractDataFileLinks('<p>no links</p>', base)).toEqual([])
  })
})

describe('extractPublicationSchedule (公表予定日)', () => {
  // ページ実物は全角括弧・全角コロン・全角数字混在 + 整列用の半角スペース
  const html = `
    <h3>公表予定日</h3>
    <p>
      6月24日（水）14：00<br>
      7月　1日（水）14：00<br>
      7月　8日（水）14：00<br>
      7月15日（水）14：00<br>
      ※原則、毎週月曜日調査、水曜日公表
    </p>
  `

  it('全角混在を NFKC 正規化して日時を抽出 (年は now から補完)', () => {
    const now = new Date(Date.UTC(2026, 5, 23)) // 2026-06-23
    const sched = extractPublicationSchedule(html, now)
    expect(sched).toEqual([
      { date: '2026-06-24', time: '14:00', weekday: '水' },
      { date: '2026-07-01', time: '14:00', weekday: '水' },
      { date: '2026-07-08', time: '14:00', weekday: '水' },
      { date: '2026-07-15', time: '14:00', weekday: '水' },
    ])
  })

  it('現在月より小さい月は翌年扱い (12月→1月 年跨ぎ)', () => {
    const now = new Date(Date.UTC(2026, 11, 30)) // 2026-12-30
    const sched = extractPublicationSchedule('1月7日(水)14:00', now)
    expect(sched).toEqual([{ date: '2027-01-07', time: '14:00', weekday: '水' }])
  })

  it('重複は除去、日付昇順', () => {
    const now = new Date(Date.UTC(2026, 5, 1))
    const dup = '7月8日(水)14:00 7月8日(水)14:00 6月24日(水)14:00'
    const sched = extractPublicationSchedule(dup, now)
    expect(sched.map((s) => s.date)).toEqual(['2026-06-24', '2026-07-08'])
  })

  it('予定日が無ければ空配列', () => {
    expect(extractPublicationSchedule('<p>公表予定日は未定です</p>')).toEqual([])
  })
})

describe('weeklyKeyFromUrl', () => {
  const base = 'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/xlsx/'
  it('YYMMDDs5.xlsx の YYMMDD を返す', () => {
    expect(weeklyKeyFromUrl(`${base}260617s5.xlsx`)).toBe('260617')
  })
  it('形式不一致は null', () => {
    expect(weeklyKeyFromUrl(`${base}260617.xlsx`)).toBeNull()
    expect(weeklyKeyFromUrl('not a url')).toBeNull()
  })
  it('pickLatestWeeklyXlsxUrl の戻り値と整合', () => {
    const url = pickLatestWeeklyXlsxUrl([`${base}260529s5.xlsx`, `${base}260617s5.xlsx`])
    expect(url && weeklyKeyFromUrl(url)).toBe('260617')
  })
})
