// Cloudflare Workers の binding (`env`) を scheduled task から読むための最小宣言。
// @cloudflare/workers-types を入れず、必要な export だけ宣言する (src/distance-db.ts の
// 手書き D1 型と同方針)。実体は CF runtime が提供 (compatibility_date 2025-07-15)。
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
