import { describe, it, expect } from 'vitest'
import { replaceResultsByRowId } from '../src/shimebi-merge'
import type { SurchargeResult, MeisaiRow } from '../src/surcharge'

function res(rowId: string | undefined, amount: number): SurchargeResult {
  return {
    row: { rowId, tokuiC: 'A', fromPref: '熊本県', toPref: '長崎県', sharuC: '01', uriageDate: '2026-05-03', seikyuDate: '2026-06-30' } as MeisaiRow,
    status: 'ok',
    amount,
  }
}

describe('replaceResultsByRowId', () => {
  it('該当 row_id の行を fresh に差し替え、順序維持', () => {
    const current = [res('R1', 10), res('R2', 20), res('R3', 30)]
    const out = replaceResultsByRowId(current, 'R2', [res('R2', 99)])
    expect(out.map((r) => [r.row.rowId, r.amount])).toEqual([
      ['R1', 10],
      ['R2', 99],
      ['R3', 30],
    ])
  })

  it('row_id が無ければ現状のまま', () => {
    const current = [res('R1', 10)]
    expect(replaceResultsByRowId(current, 'X', [res('X', 1)])).toBe(current)
  })

  it('空 rowId は現状のまま', () => {
    const current = [res('R1', 10)]
    expect(replaceResultsByRowId(current, '', [])).toBe(current)
  })

  it('同一 row_id 複数行 (積み合わせ) は最初の位置にまとめて差し込み、旧行は除去', () => {
    const current = [res('R1', 10), res('R2', 20), res('R1', 11), res('R3', 30)]
    const out = replaceResultsByRowId(current, 'R1', [res('R1', 100), res('R1', 101)])
    expect(out.map((r) => [r.row.rowId, r.amount])).toEqual([
      ['R1', 100],
      ['R1', 101],
      ['R2', 20],
      ['R3', 30],
    ])
  })

  it('fresh が空 (source から消えた) なら旧行を取り除く', () => {
    const current = [res('R1', 10), res('R2', 20)]
    const out = replaceResultsByRowId(current, 'R1', [])
    expect(out.map((r) => r.row.rowId)).toEqual(['R2'])
  })
})
