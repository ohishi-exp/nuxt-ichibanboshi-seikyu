import type { H3Event } from 'h3'
import { requireAuth as introspectRequireAuth } from '@ippoan/auth-client/server'

// ブラウザ JWT (logi_auth_token cookie / Bearer) の検証を auth-worker
// POST /auth/introspect に委譲する認証 gate (ippoan/auth-worker#290 Phase 3)。
//
// 本 worker は **JWT_SECRET (署名鍵) を持たない**。INTERNAL_SHARED_SECRET で
// introspect を叩き、auth-worker 側で ① 署名検証 ② APP_TENANT_ACL による
// origin×tenant 判定 を行った結果 { active, tenant_id, role, email } を受け取る。
// これにより共有 HS256 鍵を本 repo から撤去し、別アプリ cookie の流用
// (#290 穴 #3) を auth-worker 側 APP_TENANT_ACL で塞ぐ。
//
// `@ippoan/auth-client/server` の requireAuth が cookie/Bearer 抽出・introspect・
// short-TTL cache・401 throw を担うので、本ファイルは binding 解決と
// authWorkerUrl 注入の薄いラッパーに徹する。

/** auth-worker /auth/introspect が返す active なクレーム。 */
export type AuthClaims = {
  active: true
  tenant_id: string
  role: string
  email: string
  exp?: number
}

/** Secrets Store binding (`.get()`) / 文字列 のいずれでも値を取り出す。 */
async function resolveSecret(binding: unknown): Promise<string | null> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? null
  }
  return null
}

function cfEnv(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare as { env?: Record<string, unknown> } | undefined)?.env ?? {}
}

/**
 * 保護エンドポイントで呼ぶ認証 gate。INTERNAL_SHARED_SECRET で auth-worker の
 * introspect を叩き、active な claims を返す。inactive (署名不正 / exp 切れ /
 * 不許可テナント) は auth-client 側が 401 を throw する。binding 未設定は 503。
 */
export async function requireAuth(event: H3Event): Promise<AuthClaims> {
  const env = cfEnv(event)
  const sharedSecret = await resolveSecret(env.INTERNAL_SHARED_SECRET)
  if (!sharedSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'INTERNAL_SHARED_SECRET binding が未設定です',
    })
  }
  const authWorkerUrl =
    typeof env.NUXT_PUBLIC_AUTH_WORKER_URL === 'string' && env.NUXT_PUBLIC_AUTH_WORKER_URL
      ? env.NUXT_PUBLIC_AUTH_WORKER_URL
      : 'https://auth.ippoan.org'

  // origin は auth-client 側で getRequestURL(event).origin から解決される
  // (custom_domain route なので公開 origin = ichibanboshi-seikyu.ippoan.org)。
  return (await introspectRequireAuth(event, { authWorkerUrl, sharedSecret })) as AuthClaims
}

/**
 * JWT claims が管理者か (role === 'admin')。viewer / role 欠落は false。
 * role claim は auth-worker / rust-alc-api のブラウザ JWT に乗り、introspect の
 * 出力にも含まれる。
 */
export function isAdminPayload(payload: { role?: unknown }): boolean {
  return payload.role === 'admin'
}

/**
 * 管理者 (role === 'admin') だけを通す gate。requireAuth で introspect した上で
 * role claim を見る。admin 以外は 403。マスタの参照・更新は全て管理者限定
 * (= 大石運輸倉庫テナントの admin のみ)。
 */
export async function requireAdmin(event: H3Event): Promise<AuthClaims> {
  const payload = await requireAuth(event)
  if (!isAdminPayload(payload)) {
    throw createError({ statusCode: 403, statusMessage: '管理者権限が必要です' })
  }
  return payload
}
