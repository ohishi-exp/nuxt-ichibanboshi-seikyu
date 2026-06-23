import type { H3Event } from 'h3'

// 一番星 (rust-ichibanboshi) への発信設定を Cloudflare env から取り出す。
// rust-ichiban.mtamaramu.com は Cloudflare Access (Service Token) で保護されているため
// CF-Access-Client-Id / CF-Access-Client-Secret を付けて呼ぶ (nuxt-ichibanboshi と同方式)。
//
// 設定値:
//   ICHIBAN_API_BASE         [vars]            例: https://rust-ichiban.mtamaramu.com
//   CF_ACCESS_CLIENT_ID      [vars]            service token の client id (.access 付き)
//   CF_ACCESS_CLIENT_SECRET  [secret/binding]  service token の client secret
//
// いずれか欠落時は null を返し、呼び出し側は 503 (連携未設定) を返してフォールバックする。

/** Secrets Store binding (`.get()`) / 文字列のどちらでも値を取り出す */
async function resolveSecret(binding: unknown): Promise<string | null> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? null
  }
  return null
}

export interface IchibanConfig {
  base: string
  clientId: string
  clientSecret: string
}

/** 一番星連携の設定を解決する。1 つでも欠ければ null (= 未設定) */
export async function resolveIchibanConfig(event: H3Event): Promise<IchibanConfig | null> {
  const env = (
    event.context.cloudflare as
      | {
          env?: {
            ICHIBAN_API_BASE?: string
            CF_ACCESS_CLIENT_ID?: string
            CF_ACCESS_CLIENT_SECRET?: unknown
          }
        }
      | undefined
  )?.env
  const base = env?.ICHIBAN_API_BASE
  const clientId = env?.CF_ACCESS_CLIENT_ID
  const clientSecret = await resolveSecret(env?.CF_ACCESS_CLIENT_SECRET)
  if (!base || !clientId || !clientSecret) return null
  return { base, clientId, clientSecret }
}
