// @aznex/service — single deployable service
// Exposes two route groups over one shared auth/permission module:
//   POST /v1/ingest   — ingestion endpoint (workers POST here)
//   /mcp              — MCP endpoint (agents query here)
//   /api              — frontend read/query API
// This is the only tier with database credentials.

export { createApp } from './app.js';
export type { AppEnv } from './app.js';
export { loadConfig } from './config.js';
export { openDatabase } from './db/connection.js';
export { ensureSchema } from './db/schema.js';
export { runMigrations } from './db/migrations.js';
export { stringifyJson, parseJsonArray, parseJsonObject, parseJsonUnknown } from './db/serde.js';

export { UserRepository } from './repositories/user.js';
export { GithubInstallationRepository } from './repositories/github-installation.js';
export { RepoRepository } from './repositories/repo.js';
export { ApiKeyRepository } from './repositories/api-key.js';
export { RepoMemberRepository } from './repositories/repo-member.js';
export { SessionRepository } from './repositories/session.js';
export { MemoryRepository } from './repositories/memory.js';
export { MemoryAnchorRepository } from './repositories/memory-anchor.js';
export { AgentEventRepository } from './repositories/agent-event.js';

export type {
  IUserRepository,
  IGithubInstallationRepository,
  IRepoRepository,
  IApiKeyRepository,
  IRepoMemberRepository,
  ISessionRepository,
  IMemoryRepository,
  IMemoryAnchorRepository,
  IAgentEventRepository,
} from './repositories/interfaces.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────
// Only start the server when run directly (`bun src/index.ts`), not when imported.
if (import.meta.main) {
  const { openDatabase } = await import('./db/connection.js');
  const { createApp } = await import('./app.js');
  const { loadConfig } = await import('./config.js');
  const { createAuth, migrateAuthSchema } = await import('./auth/session.js');
  const config = loadConfig();
  const db = openDatabase();
  const auth = createAuth(db);
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });
  console.log(`@aznex/service listening on :${config.port}`);
  Bun.serve({ port: config.port, fetch: app.fetch });
}
