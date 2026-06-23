import { describe, it, expect } from 'vitest'
import {
  isAllowedSourceUrl,
  extractDataFileLinks,
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
