import { describe, it, expect } from 'vitest'
import { buildLineworksConfig, buildNotifyFn, type LineworksEnv } from '../server/utils/lineworks-notify'

const FULL_STR: LineworksEnv = {
  LINEWORKS_BOT_ID: '777',
  LINEWORKS_CLIENT_ID: 'cid',
  LINEWORKS_SERVICE_ACCOUNT: 'sa@x',
  LINEWORKS_TARGET_TYPE: 'user',
  LINEWORKS_TARGET_ID: 'u1',
  LINEWORKS_CLIENT_SECRET: 'csecret',
  LINEWORKS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
}

describe('buildLineworksConfig', () => {
  it('env なしは null', async () => {
    expect(await buildLineworksConfig(undefined)).toBeNull()
  })

  it('全部揃えば config (文字列 secret)', async () => {
    const cfg = await buildLineworksConfig(FULL_STR)
    expect(cfg).not.toBeNull()
    expect(cfg?.botId).toBe('777')
    expect(cfg?.targetType).toBe('user')
    expect(cfg?.clientSecret).toBe('csecret')
  })

  it('Secrets Store binding (.get()) からも解決', async () => {
    const env: LineworksEnv = {
      ...FULL_STR,
      LINEWORKS_CLIENT_SECRET: { get: async () => 'from-store' },
      LINEWORKS_PRIVATE_KEY: { get: async () => 'pem-from-store' },
    }
    const cfg = await buildLineworksConfig(env)
    expect(cfg?.clientSecret).toBe('from-store')
    expect(cfg?.privateKeyPem).toBe('pem-from-store')
  })

  it('targetType が user 以外なら channel に丸める', async () => {
    const cfg = await buildLineworksConfig({ ...FULL_STR, LINEWORKS_TARGET_TYPE: 'foo' })
    expect(cfg?.targetType).toBe('channel')
  })

  it('1 つでも欠けたら null (例: client_secret 空)', async () => {
    expect(await buildLineworksConfig({ ...FULL_STR, LINEWORKS_CLIENT_SECRET: '' })).toBeNull()
    expect(await buildLineworksConfig({ ...FULL_STR, LINEWORKS_BOT_ID: undefined })).toBeNull()
  })
})

describe('buildNotifyFn', () => {
  it('設定不足なら undefined (通知 skip)', async () => {
    expect(await buildNotifyFn(undefined)).toBeUndefined()
    expect(await buildNotifyFn({ LINEWORKS_BOT_ID: '777' })).toBeUndefined()
  })

  it('設定が揃えば関数を返す', async () => {
    const fn = await buildNotifyFn(FULL_STR)
    expect(typeof fn).toBe('function')
  })
})
