// LINE WORKS Bot API client (Web Crypto)。Refs #11 (#2 軽油価格 自動取込 完了通知)
//
// rust-alc-api の crates/alc-notify/src/clients/lineworks.rs を Worker (Web Crypto) に移植。
// 認証は JWT(RS256) assertion → OAuth2 token (scope=bot) → bot message 送信。
//   1. JWT { iss: clientId, sub: serviceAccount, iat, exp: iat+60 } を private key で RS256 署名
//   2. POST https://auth.worksmobile.com/oauth2/v2.0/token (grant_type=jwt-bearer) → access_token
//   3. POST https://www.worksapis.com/v1.0/bots/{botId}/{channels|users}/{id}/messages
//
// private key は **PKCS#8 (BEGIN PRIVATE KEY)** のみ対応。PKCS#1 (BEGIN RSA PRIVATE KEY) は
// secrets-inventory の convert_secret_pkcs8 で変換してから投入する (Web Crypto の importKey は
// pkcs8 しか受け付けないため)。送信失敗は throw せず {ok:false, reason} で返す (fail-open)。

const encoder = new TextEncoder()

export interface LineworksBotConfig {
  clientId: string
  clientSecret: string
  serviceAccount: string
  /** PKCS#8 PEM (BEGIN PRIVATE KEY) */
  privateKeyPem: string
  botId: string
  /** 送信先種別。トークルーム(channel) か 個人(user) */
  targetType: 'channel' | 'user'
  /** channelId または userId */
  targetId: string
}

export interface LineworksEndpoints {
  tokenUrl: string
  /** 末尾スラッシュ付き (例: https://www.worksapis.com/v1.0/bots/) */
  botBaseUrl: string
}

export const LINEWORKS_PROD_ENDPOINTS: LineworksEndpoints = {
  tokenUrl: 'https://auth.worksmobile.com/oauth2/v2.0/token',
  botBaseUrl: 'https://www.worksapis.com/v1.0/bots/',
}

export interface BotJwtClaims {
  iss: string
  sub: string
  iat: number
  exp: number
}

/** JWT assertion の claim を組み立てる (純粋)。exp は iat+60 秒 (LINE WORKS 規約: 短命) */
export function buildBotJwtClaims(clientId: string, serviceAccount: string, now: number): BotJwtClaims {
  return { iss: clientId, sub: serviceAccount, iat: now, exp: now + 60 }
}

/** bot message 送信先 URL を組み立てる (純粋)。channel → /channels/、user → /users/ */
export function buildMessageUrl(
  botBaseUrl: string,
  botId: string,
  targetType: 'channel' | 'user',
  targetId: string,
): string {
  const seg = targetType === 'user' ? 'users' : 'channels'
  return `${botBaseUrl}${botId}/${seg}/${encodeURIComponent(targetId)}/messages`
}

/** text メッセージの body (純粋) */
export function buildTextMessageBody(text: string): { content: { type: 'text'; text: string } } {
  return { content: { type: 'text', text } }
}

/** bytes → base64url (no padding) */
function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** UTF-8 文字列 → base64url (JWT segment 用) */
function strToB64url(s: string): string {
  return bytesToB64url(encoder.encode(s))
}

/**
 * PKCS#8 PEM → DER bytes (純粋)。PKCS#1 (BEGIN RSA PRIVATE KEY) は Web Crypto が
 * importKey('pkcs8') で受け付けられないので明示エラーにする (convert_secret_pkcs8 で変換)。
 */
export function pkcs8PemToDer(pem: string): Uint8Array {
  const norm = pem.replace(/\r/g, '')
  if (/BEGIN RSA PRIVATE KEY/.test(norm)) {
    throw new Error(
      'private key が PKCS#1 (BEGIN RSA PRIVATE KEY) です。PKCS#8 に変換してから投入してください',
    )
  }
  const m = norm.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/)
  const body = (m ? (m[1] as string) : norm).replace(/\s+/g, '')
  const bin = atob(body)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** RS256 で JWT assertion を作る (Web Crypto)。署名鍵は PKCS#8 PEM */
export async function buildBotJwt(
  clientId: string,
  serviceAccount: string,
  privateKeyPem: string,
  now: number,
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = buildBotJwtClaims(clientId, serviceAccount, now)
  const signingInput = `${strToB64url(JSON.stringify(header))}.${strToB64url(JSON.stringify(claims))}`
  const der = pkcs8PemToDer(privateKeyPem)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput))
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * JWT assertion → OAuth2 access_token (scope=bot)。失敗時は Error を throw。
 */
export async function issueBotToken(
  cfg: LineworksBotConfig,
  endpoints: LineworksEndpoints,
  now: number,
  fetchImpl: FetchLike,
): Promise<string> {
  const assertion = await buildBotJwt(cfg.clientId, cfg.serviceAccount, cfg.privateKeyPem, now)
  const form = new URLSearchParams({
    assertion,
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'bot',
  })
  const res = await fetchImpl(endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!res.ok) {
    throw new Error(`token issue failed: ${res.status}`)
  }
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('token response に access_token がありません')
  return data.access_token
}

export interface SendResult {
  ok: boolean
  status?: number
  reason?: string
}

export interface SendOptions {
  endpoints?: LineworksEndpoints
  now?: number
  fetchImpl?: FetchLike
  /** token 発行を差し替える (テスト用)。未指定なら issueBotToken */
  issueToken?: (cfg: LineworksBotConfig, ep: LineworksEndpoints, now: number, f: FetchLike) => Promise<string>
}

/**
 * bot に text メッセージを送る。**fail-open**: 失敗しても throw せず {ok:false, reason} を返す
 * (cron の主目的=取込は成功扱いを保つため。呼び出し側で log する)。
 */
export async function sendBotText(
  cfg: LineworksBotConfig,
  text: string,
  opts: SendOptions = {},
): Promise<SendResult> {
  const endpoints = opts.endpoints ?? LINEWORKS_PROD_ENDPOINTS
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init))
  const issue = opts.issueToken ?? issueBotToken
  try {
    const token = await issue(cfg, endpoints, now, fetchImpl)
    const url = buildMessageUrl(endpoints.botBaseUrl, cfg.botId, cfg.targetType, cfg.targetId)
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTextMessageBody(text)),
    })
    if (!res.ok) return { ok: false, status: res.status, reason: `send failed: ${res.status}` }
    return { ok: true, status: res.status }
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
