import { describe, it, expect } from 'vitest'
import { isAdminPayload } from '../server/utils/auth'

// ブラウザ JWT の署名検証は auth-worker POST /auth/introspect に委譲済み
// (ippoan/auth-worker#290 Phase 3)。本 worker は JWT_SECRET を持たないため、
// 旧 verifyJwtHs256 の署名/exp/改ざん検証テストは廃止した。検証ロジックは:
//   - 署名 / exp / env claim / APP_TENANT_ACL: auth-worker #291 (handler test)
//   - introspect 呼び出し / cache / fail-closed: @ippoan/auth-client #292 (100% cov)
// にそれぞれ集約されている。ここに残るのは本 repo 固有の純粋関数 isAdminPayload のみ。

describe('isAdminPayload', () => {
  it('role === "admin" → true', () => {
    expect(isAdminPayload({ role: 'admin' })).toBe(true)
  })
  it('viewer / role 欠落 / 別値 → false', () => {
    expect(isAdminPayload({ role: 'viewer' })).toBe(false)
    expect(isAdminPayload({})).toBe(false)
    expect(isAdminPayload({ role: 'Admin' })).toBe(false)
  })
})
