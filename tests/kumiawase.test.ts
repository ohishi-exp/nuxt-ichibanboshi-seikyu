import { describe, it, expect } from 'vitest'
import { kumiawaseKey, detectKumiawaseKeys, type KumiawaseRow } from '../src/kumiawase'

function row(over: Partial<KumiawaseRow> = {}): KumiawaseRow {
  return { uriageDate: '2026-05-03', vehicleNumber: '4561', fromPref: '熊本県', ...over }
}

describe('kumiawaseKey', () => {
  it('売上日+車番+積地 を tab 連結', () => {
    expect(kumiawaseKey(row())).toBe('2026-05-03\t4561\t熊本県')
  })
  it('車番が無い行は null (判定対象外)', () => {
    expect(kumiawaseKey(row({ vehicleNumber: '' }))).toBeNull()
    expect(kumiawaseKey(row({ vehicleNumber: undefined }))).toBeNull()
    expect(kumiawaseKey(row({ vehicleNumber: '  ' }))).toBeNull()
  })
})

describe('detectKumiawaseKeys', () => {
  it('同一 (売上日+車番+積地) が 2 行以上 → そのキーを返す (品目/卸地違いの積み合わせ)', () => {
    const keys = detectKumiawaseKeys([
      row({ vehicleNumber: '4561' }), // 大石後期M 卸=長崎
      row({ vehicleNumber: '4561' }), // 大石仕上M 卸=長崎 (同車・同日・同積地)
      row({ uriageDate: '2026-05-04', vehicleNumber: '4561' }), // 別日 → 単独
    ])
    expect([...keys]).toEqual(['2026-05-03\t4561\t熊本県'])
  })

  it('卸地違いでも 売上日+車番+積地 が同じなら積み合わせ', () => {
    const keys = detectKumiawaseKeys([row(), row()]) // fromPref 同じ、卸地は本キーに含めない
    expect(keys.has('2026-05-03\t4561\t熊本県')).toBe(true)
  })

  it('車番違い / 積地違い は別グループ (単独なら警告なし)', () => {
    const keys = detectKumiawaseKeys([
      row({ vehicleNumber: '4561' }),
      row({ vehicleNumber: '9999' }), // 別車
      row({ vehicleNumber: '4561', fromPref: '福岡県' }), // 別積地
    ])
    expect(keys.size).toBe(0)
  })

  it('車番欠落行は除外 (誤検出しない)', () => {
    const keys = detectKumiawaseKeys([row({ vehicleNumber: '' }), row({ vehicleNumber: '' })])
    expect(keys.size).toBe(0)
  })

  it('空入力は空集合', () => {
    expect(detectKumiawaseKeys([]).size).toBe(0)
  })
})
