import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseDistanceCsv,
  serializeDistanceCsv,
  distanceKey,
} from '../src/distance'
import { computeRowSurcharge, type SurchargeMasters } from '../src/surcharge'

const CSV_PATH = fileURLToPath(
  new URL('../docs/surcharge/kenchokan-distance.csv', import.meta.url),
)
const realCsv = readFileSync(CSV_PATH, 'utf-8')

describe('parseDistanceCsv (実データ)', () => {
  const { master, warnings } = parseDistanceCsv(realCsv)

  it('47 県 × 47 県を警告なしで取り込む', () => {
    expect(master.prefs).toHaveLength(47)
    expect(master.prefs[0]).toBe('北海道')
    expect(master.prefs[46]).toBe('沖縄県')
    expect(warnings).toEqual([])
    // 47×47 = 2209 セル (自県含む)
    expect(Object.keys(master.distanceKm)).toHaveLength(47 * 47)
  })

  it('代表値が正しい (北海道→青森県=440)', () => {
    expect(master.distanceKm[distanceKey('北海道', '青森県')]).toBe(440)
    // 県庁間 (長崎市→福岡市) = 155km
    expect(master.distanceKm[distanceKey('長崎県', '福岡県')]).toBe(155)
  })

  it('自県は 0', () => {
    expect(master.distanceKm[distanceKey('東京都', '東京都')]).toBe(0)
  })

  it('対称 (元データが対称なので両方向同値)', () => {
    expect(master.distanceKm[distanceKey('青森県', '北海道')]).toBe(440)
  })

  it('県庁所在地も取り込む', () => {
    expect(master.cities['北海道']).toBe('札幌市')
    expect(master.cities['東京都']).toBe('新宿区')
  })
})

describe('serializeDistanceCsv / round-trip', () => {
  it('parse → serialize → parse で distanceKm が一致する', () => {
    const first = parseDistanceCsv(realCsv)
    const out = serializeDistanceCsv(first.master)
    const second = parseDistanceCsv(out)
    expect(second.warnings).toEqual([])
    expect(second.master.prefs).toEqual(first.master.prefs)
    expect(second.master.distanceKm).toEqual(first.master.distanceKm)
    expect(second.master.cities).toEqual(first.master.cities)
  })

  it('出力は UTF-8 BOM 付き', () => {
    const out = serializeDistanceCsv(parseDistanceCsv(realCsv).master)
    expect(out.charCodeAt(0)).toBe(0xfeff)
  })
})

describe('parseDistanceCsv (異常系・警告)', () => {
  it('空 CSV', () => {
    const r = parseDistanceCsv('')
    expect(r.warnings).toContain('空の CSV')
    expect(r.master.prefs).toEqual([])
  })

  it('ヘッダ列不足', () => {
    const r = parseDistanceCsv('都道府県,県庁所在地\n')
    expect(r.warnings[0]).toContain('ヘッダ列が不足')
  })

  it('非数値セルは警告し distanceKm に入れない', () => {
    const csv = '都道府県,県庁所在地,北海道,青森県\n北海道,札幌市,0,abc\n青森県,青森市,440,0\n'
    const { master, warnings } = parseDistanceCsv(csv)
    expect(warnings.some((w) => w.includes('非数値'))).toBe(true)
    expect(master.distanceKm[distanceKey('北海道', '青森県')]).toBeUndefined()
    expect(master.distanceKm[distanceKey('青森県', '北海道')]).toBe(440)
  })

  it('空セルは警告', () => {
    const csv = '都道府県,県庁所在地,北海道,青森県\n北海道,札幌市,0,\n青森県,青森市,440,0\n'
    const { warnings } = parseDistanceCsv(csv)
    expect(warnings.some((w) => w.includes('空'))).toBe(true)
  })

  it('ヘッダに無い県・重複県・自県≠0・列数不一致・行欠落を警告', () => {
    const csv =
      '都道府県,県庁所在地,北海道,青森県\n' +
      '北海道,札幌市,5,440\n' + // 自県≠0
      '北海道,札幌市,0,440\n' + // 重複
      '宮城県,仙台市,100,200\n' + // ヘッダに無い県
      '青森県,青森市,440\n' // 列数不一致 (1 列)
    const { warnings } = parseDistanceCsv(csv)
    expect(warnings.some((w) => w.includes('自県距離が 0 でない'))).toBe(true)
    expect(warnings.some((w) => w.includes('重複'))).toBe(true)
    expect(warnings.some((w) => w.includes('ヘッダに無い都道府県'))).toBe(true)
    expect(warnings.some((w) => w.includes('不一致'))).toBe(true)
  })

  it('都道府県が空の行を警告', () => {
    const csv = '都道府県,県庁所在地,北海道\n,札幌市,0\n北海道,札幌市,0\n'
    const { warnings } = parseDistanceCsv(csv)
    expect(warnings.some((w) => w.includes('都道府県が空'))).toBe(true)
  })

  it('formula injection: = + - @ 始まりの文字列セルを serialize で無害化する', () => {
    const master = {
      prefs: ['北海道', '青森県'],
      cities: { 北海道: '=cmd|calc', 青森県: '@SUM(A1)' },
      distanceKm: { [distanceKey('北海道', '青森県')]: 440 },
    }
    const out = serializeDistanceCsv(master).replace('﻿', '')
    // 危険な先頭文字のセルは ' 前置される
    expect(out).toContain("'=cmd|calc")
    expect(out).toContain("'@SUM(A1)")
    expect(out).not.toContain(',=cmd|calc')
    // 通常の県名/数値はそのまま
    expect(out).toContain('北海道')
    expect(out).toContain('440')
  })

  it('未登録ペアは serialize で空セルになる', () => {
    const master = {
      prefs: ['北海道', '青森県'],
      cities: { 北海道: '札幌市', 青森県: '青森市' },
      distanceKm: { [distanceKey('北海道', '青森県')]: 440 },
    }
    const out = serializeDistanceCsv(master)
    // 青森→北海道 は未登録 → 空セル
    const lines = out.replace('﻿', '').trim().split('\n')
    expect(lines[2]).toBe('青森県,青森市,,0')
  })
})

describe('surcharge エンジンへの流し込み', () => {
  it('parse した distanceKm で距離制計算が動く', () => {
    const { master } = parseDistanceCsv(realCsv)
    const masters: SurchargeMasters = {
      basePrice: 100,
      monthlyDieselPrice: { '2026-05': 130 },
      fuelEfficiency: { '04': 4.0 },
      distanceKm: master.distanceKm,
    }
    const r = computeRowSurcharge(
      {
        tokuiC: 'T1',
        fromPref: '長崎県',
        toPref: '福岡県',
        sharuC: '04',
        uriageDate: '2026-05-10',
        unchin: 0,
        seikyuDate: '2026-06-30',
      },
      masters,
    )
    // 上昇額 27.5 × 155km(県庁間 長崎市→福岡市) ÷ 4.0 = 1065.625 → ceil 1066
    expect(r.status).toBe('ok')
    expect(r.km).toBe(155)
    expect(r.amount).toBe(1066)
  })
})
