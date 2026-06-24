import { describe, it, expect } from 'vitest'
import {
  mapToMeisaiRows,
  isAdjustmentRow,
  ownershipLabel,
  type IchibanSurchargeRow,
} from './surcharge-review'

function row(over: Partial<IchibanSurchargeRow> = {}): IchibanSurchargeRow {
  return {
    request_kind: '0',
    customer_code: '011810',
    customer_name: 'アサカワトランテック㈱',
    origin_prefecture: '福岡県',
    dest_prefecture: '東京都',
    vehicle_code: '01',
    vehicle_name: '',
    sale_date: '2026-05-09',
    fare: 256390,
    billing_date: '2026-07-20',
    subcontractor_code: '000000',
    item_code: '1000',
    item_name: 'サイロ',
    ...over,
  }
}

describe('isAdjustmentRow', () => {
  it('一括調整明細 (※請求一括調整明細※) は true', () => {
    expect(isAdjustmentRow(row({ item_name: '※　請求一括調整明細　※' }))).toBe(true)
    expect(isAdjustmentRow(row({ item_name: '※　傭車一括調整明細　※' }))).toBe(true)
  })
  it('実サーチャージ請求行 / 端数調整 / 通常品名 / 欠落は false (誤除外しない)', () => {
    expect(isAdjustmentRow(row({ item_name: '燃料油価格変動調整金' }))).toBe(false)
    expect(isAdjustmentRow(row({ item_name: '燃料調整金' }))).toBe(false)
    expect(isAdjustmentRow(row({ item_name: '端数調整' }))).toBe(false)
    expect(isAdjustmentRow(row({ item_name: 'サイロ' }))).toBe(false)
    expect(isAdjustmentRow(row({ item_name: undefined }))).toBe(false)
  })
})

describe('mapToMeisaiRows 品名 passthrough', () => {
  it('item_code/item_name を itemCode/itemName に写像する', () => {
    const [m] = mapToMeisaiRows([row({ item_code: '0000', item_name: '※　請求一括調整明細　※' })])
    expect(m.itemCode).toBe('0000')
    expect(m.itemName).toBe('※　請求一括調整明細　※')
  })
})

describe('ownershipLabel', () => {
  it('自車 / 傭車 / —', () => {
    expect(ownershipLabel('000000')).toBe('自車')
    expect(ownershipLabel('001234')).toBe('傭車')
    expect(ownershipLabel('')).toBe('—')
    expect(ownershipLabel(undefined)).toBe('—')
  })
})
