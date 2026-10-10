import type { H3Event } from 'h3'

// 一番星 Worker (Service Binding `ICHIBAN_DB`) を呼ぶ。Worker は binding 専用で認可を持たない。
// Refs ohishi-exp/rust-ichibanboshi#322

/**
 * 一番星 Worker (Service Binding ICHIBAN_DB) へ GET を投げる。
 * Worker は binding 専用で認可を持たないため、Authorization も CF Access ヘッダも付けない。
 * binding が無ければ null (= 未設定。呼び出し側は 200 + reason: 'not_configured' を返す)。
 * fetch の例外 (接続失敗) は呼び出し側で捕捉する。
 */
export function fetchIchiban(event: H3Event, path: string, query?: string): Promise<Response> | null {
  const binding = (
    event.context.cloudflare as { env?: { ICHIBAN_DB?: { fetch(r: Request): Promise<Response> } } } | undefined
  )?.env?.ICHIBAN_DB
  if (!binding || typeof binding.fetch !== 'function') return null
  return binding.fetch(new Request(`https://ichibanboshi-ichiban${path}${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }))
}
