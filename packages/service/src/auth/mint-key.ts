import { randomBytes } from "crypto";
import type { Database } from "bun:sqlite";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { hashToken } from "../middleware/auth.js";

// Mints an API key for an existing user. The plaintext token is returned
// exactly once; only its hash is stored.
export function mintApiKey(db: Database, userId: string, name = "worker"): string {
  const token = `axk_${randomBytes(24).toString("hex")}`;
  new ApiKeyRepository(db).create({
    user_id: userId,
    name,
    key_hash: hashToken(token),
    prefix: token.slice(0, 8),
    scopes: ["ingest"],
    status: "active",
    last_used_at_epoch: null,
    expires_at_epoch: null,
    metadata: {},
  });
  return token;
}
