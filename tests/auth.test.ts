import { describe, it, expect } from 'vitest'
import { verifyJwtHs256 } from '../server/utils/auth'

const enc = new TextEncoder()
const SECRET = 'test-shared-hs256-secret'

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`)))
  return `${header}.${body}.${b64url(sig)}`
}

const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 10

describe('verifyJwtHs256', () => {
  it('正しい署名 + 未失効 → payload を返す', async () => {
    const token = await signHs256({ sub: 'u1', tenant_id: 't1', exp: future }, SECRET)
    const payload = await verifyJwtHs256(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.sub).toBe('u1')
    expect(payload?.tenant_id).toBe('t1')
  })

  it('exp なしでも署名が合えば通る', async () => {
    const token = await signHs256({ sub: 'u1' }, SECRET)
    expect(await verifyJwtHs256(token, SECRET)).not.toBeNull()
  })

  it('exp 切れ → null', async () => {
    const token = await signHs256({ sub: 'u1', exp: past }, SECRET)
    expect(await verifyJwtHs256(token, SECRET)).toBeNull()
  })

  it('別 secret で署名 → null', async () => {
    const token = await signHs256({ sub: 'u1', exp: future }, 'other-secret')
    expect(await verifyJwtHs256(token, SECRET)).toBeNull()
  })

  it('署名改ざん → null', async () => {
    const token = await signHs256({ sub: 'u1', exp: future }, SECRET)
    const parts = token.split('.')
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`
    expect(await verifyJwtHs256(tampered, SECRET)).toBeNull()
  })

  it('payload 改ざん (署名は古いまま) → null', async () => {
    const token = await signHs256({ sub: 'u1', exp: future }, SECRET)
    const parts = token.split('.')
    const evilBody = b64url(enc.encode(JSON.stringify({ sub: 'admin', exp: future })))
    expect(await verifyJwtHs256(`${parts[0]}.${evilBody}.${parts[2]}`, SECRET)).toBeNull()
  })

  it('形式不正 (3 part でない) → null', async () => {
    expect(await verifyJwtHs256('a.b', SECRET)).toBeNull()
    expect(await verifyJwtHs256('', SECRET)).toBeNull()
  })
})
