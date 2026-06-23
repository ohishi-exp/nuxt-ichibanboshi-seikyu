import type { H3Event } from 'h3'

// auth-worker のブラウザ JWT を server 側で署名検証する (距離制 /api/distance の gate)。
// auth-worker は HS256 / JWT_SECRET (rust-alc-api・hcreader と CF Secrets Store 共有、
// Refs HealthConnectReaderWorker#15) で署名する。同 secret を bind して検証する。
// cookie 名は auth-client の AUTH_COOKIE_NAME = 'logi_auth_token' (Domain=.ippoan.org)。

const AUTH_COOKIE = 'logi_auth_token'
const encoder = new TextEncoder()

/** base64url → bytes */
function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const rem = b64.length % 4
  if (rem) b64 += '='.repeat(4 - rem)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Secrets Store binding (`.get()`) / 文字列 / 関数 のいずれでも値を取り出す */
async function resolveSecret(binding: unknown): Promise<string | null> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? null
  }
  return null
}

/**
 * HS256 JWT を署名検証し payload を返す。署名不一致 / exp 切れ / 形式不正は null。
 * crypto.subtle.verify を使うので constant-time。
 */
export async function verifyJwtHs256(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  if (!h || !p || !sig) return null
  let valid = false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sig) as BufferSource,
      encoder.encode(`${h}.${p}`) as BufferSource,
    )
  } catch {
    return null
  }
  if (!valid) return null

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null
  return payload
}

/** Authorization: Bearer か logi_auth_token cookie から JWT を取り出す */
function extractToken(event: H3Event): string | null {
  const auth = getHeader(event, 'authorization')
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return getCookie(event, AUTH_COOKIE) ?? null
}

/**
 * /api/distance 等の保護エンドポイントで呼ぶ認証 gate。
 * auth-worker JWT を署名検証し、失敗時は 401 (JWT_SECRET 未設定は 503)。
 * 返り値は検証済み payload。tenant 制限自体は auth-worker (APP_TENANT_ACL) が
 * ログイン段で gate 済みのため、ここでは「有効な auth-worker token か」を検証する。
 */
export async function requireAuth(event: H3Event): Promise<Record<string, unknown>> {
  const secret = await resolveSecret(
    (event.context.cloudflare as { env?: { JWT_SECRET?: unknown } } | undefined)?.env?.JWT_SECRET,
  )
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'JWT_SECRET binding が未設定です' })
  }
  const token = extractToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '認証が必要です (auth-worker ログイン)' })
  }
  const payload = await verifyJwtHs256(token, secret)
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'JWT の検証に失敗しました' })
  }
  return payload
}

/**
 * JWT payload が管理者か (role === 'admin')。viewer / role 欠落は false。
 * role claim は auth-worker / rust-alc-api のブラウザ JWT に top-level で乗る
 * ('admin' | 'viewer'、auth-worker admin-users-html も同 claim を参照)。
 */
export function isAdminPayload(payload: Record<string, unknown>): boolean {
  return payload.role === 'admin'
}

/**
 * 管理者 (role === 'admin') だけを通す gate。requireAuth で署名検証した上で
 * JWT の `role` claim を見る。admin 以外は 403。
 * マスタの参照・更新は全て管理者限定 (= 大石運輸倉庫テナントの admin のみ)。
 */
export async function requireAdmin(event: H3Event): Promise<Record<string, unknown>> {
  const payload = await requireAuth(event)
  if (!isAdminPayload(payload)) {
    throw createError({ statusCode: 403, statusMessage: '管理者権限が必要です' })
  }
  return payload
}
