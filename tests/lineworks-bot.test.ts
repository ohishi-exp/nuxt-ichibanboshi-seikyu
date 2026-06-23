import { describe, it, expect } from 'vitest'
import {
  buildBotJwtClaims,
  buildMessageUrl,
  buildTextMessageBody,
  pkcs8PemToDer,
  buildBotJwt,
  sendBotText,
  type LineworksBotConfig,
  type FetchLike,
} from '../src/lineworks-bot'

const CFG: LineworksBotConfig = {
  clientId: 'cid',
  clientSecret: 'csecret',
  serviceAccount: 'sa@example.com',
  privateKeyPem: '', // 個別テストで差し込む
  botId: '1234567',
  targetType: 'channel',
  targetId: 'ch-abc',
}

describe('buildBotJwtClaims', () => {
  it('exp = iat + 60、iss/sub をセット', () => {
    expect(buildBotJwtClaims('cid', 'sa@x', 1000)).toEqual({
      iss: 'cid',
      sub: 'sa@x',
      iat: 1000,
      exp: 1060,
    })
  })
})

describe('buildMessageUrl', () => {
  const base = 'https://www.worksapis.com/v1.0/bots/'
  it('channel → /channels/', () => {
    expect(buildMessageUrl(base, '777', 'channel', 'cid-1')).toBe(
      'https://www.worksapis.com/v1.0/bots/777/channels/cid-1/messages',
    )
  })
  it('user → /users/、targetId は URL エンコード', () => {
    expect(buildMessageUrl(base, '777', 'user', 'u/1')).toBe(
      'https://www.worksapis.com/v1.0/bots/777/users/u%2F1/messages',
    )
  })
})

describe('buildTextMessageBody', () => {
  it('content.type=text', () => {
    expect(buildTextMessageBody('hi')).toEqual({ content: { type: 'text', text: 'hi' } })
  })
})

describe('pkcs8PemToDer', () => {
  it('PKCS#1 (BEGIN RSA PRIVATE KEY) は明示エラー', () => {
    expect(() => pkcs8PemToDer('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----')).toThrow(
      /PKCS#1/,
    )
  })
  it('PKCS#8 は base64 body を decode', () => {
    // "AAECAwQF" = bytes 0..5
    const der = pkcs8PemToDer('-----BEGIN PRIVATE KEY-----\nAAECAwQF\n-----END PRIVATE KEY-----')
    expect(Array.from(der)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

// 実 RSA 鍵を生成して buildBotJwt の署名を公開鍵で検証する (pkcs8 path を実走)
async function generatePkcs8Pem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'] as KeyUsage[],
  )) as CryptoKeyPair
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
  const b64 = Buffer.from(pkcs8).toString('base64')
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`, publicKey: kp.publicKey }
}

function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const rem = b64.length % 4
  if (rem) b64 += '='.repeat(4 - rem)
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

describe('buildBotJwt (RS256 署名 round-trip)', () => {
  it('header.payload.signature を生成し公開鍵で検証できる', async () => {
    const { pem, publicKey } = await generatePkcs8Pem()
    const jwt = await buildBotJwt('cid', 'sa@x', pem, 1000)
    const [h, p, sig] = jwt.split('.')
    expect(h && p && sig).toBeTruthy()
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p as string)))
    expect(claims).toEqual({ iss: 'cid', sub: 'sa@x', iat: 1000, exp: 1060 })
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      b64urlToBytes(sig as string) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as BufferSource,
    )
    expect(ok).toBe(true)
  })
})

describe('sendBotText (fail-open)', () => {
  it('token 発行 → 200 で送信成功', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url)
      return new Response('{}', { status: 200 })
    }
    const res = await sendBotText(CFG, 'hello', {
      issueToken: async () => 'tok',
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    // message URL が叩かれている
    expect(calls.some((u) => u.includes('/bots/1234567/channels/ch-abc/messages'))).toBe(true)
  })

  it('送信 4xx は ok:false (throw しない)', async () => {
    const res = await sendBotText(CFG, 'x', {
      issueToken: async () => 'tok',
      fetchImpl: async () => new Response('bad', { status: 400 }),
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
  })

  it('token 発行失敗も ok:false (throw しない)', async () => {
    const res = await sendBotText(CFG, 'x', {
      issueToken: async () => {
        throw new Error('token boom')
      },
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('token boom')
  })
})
