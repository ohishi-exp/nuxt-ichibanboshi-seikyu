// 環境 (vars + CF Secrets Store binding) から LINE WORKS bot 設定を組み立て、
// cron の notify コールバックを作る。Refs #11 (#2)
//
// 必要な設定 (どれか欠けると notify は無効=undefined、cron の取込自体は成功扱いを保つ):
//   vars:    LINEWORKS_BOT_ID / LINEWORKS_CLIENT_ID / LINEWORKS_SERVICE_ACCOUNT /
//            LINEWORKS_TARGET_TYPE (channel|user) / LINEWORKS_TARGET_ID
//   secrets: LINEWORKS_CLIENT_SECRET / LINEWORKS_PRIVATE_KEY (CF Secrets Store binding、PKCS#8 PEM)

import { sendBotText, type LineworksBotConfig } from '../../src/lineworks-bot'

export interface LineworksEnv {
  LINEWORKS_BOT_ID?: unknown
  LINEWORKS_CLIENT_ID?: unknown
  LINEWORKS_SERVICE_ACCOUNT?: unknown
  LINEWORKS_TARGET_TYPE?: unknown
  LINEWORKS_TARGET_ID?: unknown
  LINEWORKS_CLIENT_SECRET?: unknown
  LINEWORKS_PRIVATE_KEY?: unknown
}

/** Secrets Store binding (`.get()`) / 文字列 のいずれでも値を取り出す (auth.ts と同方式) */
async function resolveSecret(binding: unknown): Promise<string | null> {
  if (typeof binding === 'string') return binding
  if (binding && typeof (binding as { get?: unknown }).get === 'function') {
    return (await (binding as { get(): Promise<string> }).get()) ?? null
  }
  return null
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** env → LineworksBotConfig。1 つでも欠けたら null (= 通知無効) */
export async function buildLineworksConfig(
  env: LineworksEnv | undefined,
): Promise<LineworksBotConfig | null> {
  if (!env) return null
  const botId = asStr(env.LINEWORKS_BOT_ID)
  const clientId = asStr(env.LINEWORKS_CLIENT_ID)
  const serviceAccount = asStr(env.LINEWORKS_SERVICE_ACCOUNT)
  const targetId = asStr(env.LINEWORKS_TARGET_ID)
  const targetType = asStr(env.LINEWORKS_TARGET_TYPE) === 'user' ? 'user' : 'channel'
  const clientSecret = await resolveSecret(env.LINEWORKS_CLIENT_SECRET)
  const privateKeyPem = await resolveSecret(env.LINEWORKS_PRIVATE_KEY)
  if (!botId || !clientId || !serviceAccount || !targetId || !clientSecret || !privateKeyPem) {
    return null
  }
  return { botId, clientId, serviceAccount, targetType, targetId, clientSecret, privateKeyPem }
}

/**
 * cron に渡す notify コールバックを作る。設定が揃っていなければ undefined を返す
 * (= cron は通知を skip)。送信失敗 (sendBotText は fail-open) は throw しない。
 */
export async function buildNotifyFn(
  env: LineworksEnv | undefined,
): Promise<((text: string) => Promise<void>) | undefined> {
  const cfg = await buildLineworksConfig(env)
  if (!cfg) return undefined
  return async (text: string) => {
    await sendBotText(cfg, text)
  }
}
