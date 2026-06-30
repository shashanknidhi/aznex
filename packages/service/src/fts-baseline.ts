/**
 * FTS5 retrieval quality baseline — Issue #8
 *
 * Run:
 *   bun packages/service/src/fts-baseline.ts
 *
 * Uses an in-memory SQLite DB so results are deterministic and environment-independent.
 * Validates whether FTS5 (porter stemming) recall is sufficient for v1 or if
 * embeddings are required from the start.
 *
 * Pass bar: top-1 result is relevant on ≥6/8 fixture queries.
 */

import { Database } from 'bun:sqlite';
import { ensureSchema } from './db/schema.js';
import { UserRepository } from './repositories/user.js';
import { GithubInstallationRepository } from './repositories/github-installation.js';
import { RepoRepository } from './repositories/repo.js';
import { SessionRepository } from './repositories/session.js';
import { MemoryRepository } from './repositories/memory.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

const db = new Database(':memory:');
db.run('PRAGMA foreign_keys = ON');
ensureSchema(db);

const users = new UserRepository(db);
const installations = new GithubInstallationRepository(db);
const repos = new RepoRepository(db);
const sessions = new SessionRepository(db);
const memories = new MemoryRepository(db);

const FP = 'github.com/acme/api';
const now = Date.now();

const user = users.create({ github_id: '1', github_login: 'dev', display_name: 'Dev', avatar_url: null, metadata: {} });
installations.create({ installation_id: 1, account_type: 'org', account_login: 'acme', metadata: {} });
repos.create({ fingerprint: FP, canonical: 'acme/api', github_repo_id: '1', github_installation_id: 1, status: 'active', metadata: {} });
const sess = sessions.create({ id: 'sess_1', repo_fingerprint: FP, repo_canonical: 'acme/api', author_id: user.id, agent: 'claude-code', platform_source: 'claude-code', status: 'active', metadata: {}, started_at_epoch: now, ended_at_epoch: null });

// ── Helpers ───────────────────────────────────────────────────────────────────

let seq = 0;
function mem(
  type: 'raw_observation' | 'extracted_learning' | 'summary' | 'negative_result' | 'decision',
  kind: 'observation' | 'summary' | 'manual',
  title: string,
  content: string,
  opts: { facts?: string[], concepts?: string[], files?: string[] } = {},
) {
  memories.create({
    id: `m${++seq}`,
    repo_fingerprint: FP,
    session_id: sess.id,
    author_id: user.id,
    agent: 'claude-code',
    kind,
    type,
    title,
    content,
    narrative: null,
    facts: opts.facts ?? [],
    concepts: opts.concepts ?? [],
    files_read: opts.files ?? [],
    files_modified: [],
    confirmed_commit: null,
    ai_extracted: false,
    metadata: {},
  });
}

// ── Seed: 25 memories across all 5 types ──────────────────────────────────────

// raw_observation (8)
mem('raw_observation', 'observation',
  'Auth middleware uses RS256 JWT validation',
  'The authentication middleware in src/auth/middleware.ts validates JWT tokens using RS256 asymmetric keys. The public key is fetched from /auth/jwks on startup and cached in memory.',
  { facts: ['RS256 algorithm used', 'JWKS endpoint is /auth/jwks', 'public key cached at startup'], concepts: ['JWT', 'RS256', 'JWKS', 'asymmetric keys'], files: ['src/auth/middleware.ts'] });

mem('raw_observation', 'observation',
  'PostgreSQL connection pooling via pg-pool',
  'Database connections are managed through pg-pool with a max pool size of 20. The pool is initialized in src/db/pool.ts and shared across request handlers via request context.',
  { facts: ['max pool size 20', 'pool in src/db/pool.ts', 'shared via request context'], concepts: ['PostgreSQL', 'connection pool', 'pg-pool'], files: ['src/db/pool.ts'] });

mem('raw_observation', 'observation',
  'Redis cache layer with per-key TTL',
  'src/cache/redis.ts wraps ioredis with a typed get/set interface. Default TTL is 5 minutes. The cache is used for expensive database queries and external API responses.',
  { facts: ['default TTL 5 minutes', 'ioredis client', 'used for DB queries and API responses'], concepts: ['Redis', 'cache', 'TTL', 'ioredis'], files: ['src/cache/redis.ts'] });

mem('raw_observation', 'observation',
  'Rate limiting implemented with sliding window algorithm',
  'API rate limiting uses a Redis-backed sliding window counter. Limits are configured per route: 100 req/min for public endpoints, 1000 req/min for authenticated users.',
  { facts: ['sliding window counter', 'Redis-backed', '100 req/min public', '1000 req/min authenticated'], concepts: ['rate limiting', 'sliding window', 'Redis', 'API'], files: ['src/middleware/rate-limit.ts'] });

mem('raw_observation', 'observation',
  'Circuit breaker wraps external payment service calls',
  'src/services/payment.ts uses a circuit breaker pattern via the opossum library. The breaker opens after 5 consecutive failures and resets after a 30-second timeout.',
  { facts: ['opossum library', '5 failures to open', '30s reset timeout'], concepts: ['circuit breaker', 'opossum', 'fault tolerance', 'payment'], files: ['src/services/payment.ts'] });

mem('raw_observation', 'observation',
  'React query manages server state in the frontend',
  'The frontend uses TanStack Query (react-query) for all server state. Mutations invalidate relevant query keys, and stale-while-revalidate is configured globally with a 60-second stale time.',
  { facts: ['TanStack Query v5', '60s stale time', 'SWR pattern'], concepts: ['React', 'react-query', 'TanStack Query', 'server state', 'SWR'], files: ['src/frontend/query-client.ts'] });

mem('raw_observation', 'observation',
  'Docker multi-stage build reduces image size to 180MB',
  'The Dockerfile uses a 3-stage build: deps (install), build (compile TS), runtime (copy dist). Final image is based on node:20-alpine. CI publishes to GHCR on every main merge.',
  { facts: ['3-stage build', 'node:20-alpine base', 'GHCR publish on main merge', '180MB final image'], concepts: ['Docker', 'multi-stage build', 'GHCR', 'CI/CD'], files: ['Dockerfile'] });

mem('raw_observation', 'observation',
  'Zod validates all request bodies at the API boundary',
  'Every HTTP handler uses a Zod schema defined in src/schemas/ to validate and parse request bodies before processing. Validation errors return 422 with a structured error response listing all field errors.',
  { facts: ['schemas in src/schemas/', '422 on validation failure', 'structured error response'], concepts: ['Zod', 'validation', 'API boundary', 'request body'], files: ['src/schemas/'] });

// extracted_learning (6)
mem('extracted_learning', 'observation',
  'JWT tokens must be short-lived to limit exposure',
  'Access tokens should expire in 15 minutes; refresh tokens in 7 days. Longer-lived access tokens have been an incident source — an RS256-signed token was exfiltrated and used for 8 hours before expiry.',
  { facts: ['access token TTL 15 min', 'refresh token TTL 7 days'], concepts: ['JWT', 'token expiry', 'security'], files: [] });

mem('extracted_learning', 'observation',
  'Connection pool exhaustion causes cascading failures',
  'With pg-pool at default settings (max: 10), a slow database migration caused pool exhaustion and brought down the API for 12 minutes. Pool size must be tuned to expected concurrent request load.',
  { facts: ['default max 10 connections', 'pool exhaustion causes API downtime'], concepts: ['PostgreSQL', 'connection pool', 'cascading failure', 'tuning'], files: [] });

mem('extracted_learning', 'observation',
  'Redis cache stampede solved with probabilistic early expiry',
  'Under high load, cache miss spikes caused a thundering-herd on the database. Implemented probabilistic early expiry (XFetch algorithm) to refresh cache before actual expiry, eliminating the stampede.',
  { facts: ['XFetch algorithm used', 'thundering herd eliminated'], concepts: ['Redis', 'cache stampede', 'XFetch', 'probabilistic expiry'], files: [] });

mem('extracted_learning', 'observation',
  'Zod parse at boundary is cheaper than validating twice',
  'Early pattern was to validate with Zod at the HTTP layer and re-validate in the service layer. Benchmarks showed the double parse added 2ms per request. Parse once at the boundary, trust internally.',
  { facts: ['double parse adds 2ms/request', 'parse once at boundary'], concepts: ['Zod', 'validation', 'performance', 'API boundary'], files: [] });

mem('extracted_learning', 'observation',
  'Rate limit headers should be included in every response',
  'Clients need X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers to implement backoff. Missing these caused mobile clients to hammer the API until 429.',
  { facts: ['headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', '429 without headers caused hammering'], concepts: ['rate limiting', 'HTTP headers', 'backoff', 'API'], files: [] });

mem('extracted_learning', 'observation',
  'React component re-renders cut by memoising selector results',
  'Profiling revealed that parent state changes were triggering 40+ child re-renders. Wrapping derived values in useMemo and extracting stable selectors from react-query results cut renders by 80%.',
  { facts: ['40+ re-renders reduced to ~8', 'useMemo on derived values'], concepts: ['React', 'performance', 'memoisation', 'useMemo', 'react-query'], files: [] });

// summary (4)
mem('summary', 'summary',
  'Authentication subsystem architecture overview',
  'Authentication uses JWT (RS256) issued by the auth service. Access tokens expire in 15 minutes; refresh tokens in 7 days. The middleware validates tokens via JWKS at /auth/jwks. All routes except /health and /auth/* require a valid token.',
  { facts: ['RS256 JWT', '15-min access, 7-day refresh', 'JWKS at /auth/jwks', 'all routes protected except /health and /auth/*'], concepts: ['authentication', 'JWT', 'RS256', 'JWKS', 'middleware'], files: [] });

mem('summary', 'summary',
  'Database layer summary: PostgreSQL + Redis caching strategy',
  'Primary store is PostgreSQL managed through pg-pool (max 20 connections). Hot data is cached in Redis with a 5-minute default TTL. Cache invalidation is explicit per write operation. Connection pool exhaustion is the primary risk — monitored via Datadog.',
  { facts: ['PostgreSQL primary store', 'Redis cache 5min TTL', 'explicit cache invalidation', 'Datadog monitoring'], concepts: ['PostgreSQL', 'Redis', 'caching', 'connection pool', 'monitoring'], files: [] });

mem('summary', 'summary',
  'Frontend state management strategy',
  'Server state managed by TanStack Query with 60-second stale time and SWR. Local UI state uses Zustand for simple stores. No Redux — complexity is not justified by current app size.',
  { facts: ['TanStack Query for server state', 'Zustand for local UI state', 'no Redux'], concepts: ['React', 'TanStack Query', 'Zustand', 'state management', 'SWR'], files: [] });

mem('summary', 'summary',
  'CI/CD pipeline overview',
  'GitHub Actions runs typecheck, tests, and Docker build on every PR. On merge to main: image published to GHCR, staging deployment triggered automatically. Production deployment requires manual approval in GitHub Environments.',
  { facts: ['typecheck + tests on PR', 'GHCR publish on main', 'staging auto-deploy', 'prod manual approval'], concepts: ['CI/CD', 'GitHub Actions', 'Docker', 'GHCR', 'deployment'], files: [] });

// negative_result (4)
mem('negative_result', 'observation',
  'GraphQL subscriptions abandoned due to infrastructure complexity',
  'Attempted to add real-time updates via GraphQL subscriptions. WebSocket infrastructure required Redis pub/sub adapter, load balancer sticky sessions, and custom Nginx config. Complexity outweighed the benefit — switched to polling.',
  { facts: ['WebSocket needs Redis pub/sub', 'sticky sessions required', 'switched to polling'], concepts: ['GraphQL', 'WebSockets', 'real-time', 'polling'], files: [] });

mem('negative_result', 'observation',
  'Prisma ORM removed due to poor Bun compatibility and query overhead',
  'Prisma was evaluated for the database layer. It does not support Bun natively and adds 15-20ms to cold-start queries due to the query engine binary. Switched to raw SQL via pg.',
  { facts: ['no native Bun support', '15-20ms cold-start overhead', 'switched to raw SQL'], concepts: ['Prisma', 'ORM', 'Bun', 'PostgreSQL', 'performance'], files: [] });

mem('negative_result', 'observation',
  'JWT symmetric (HS256) signing rejected on security grounds',
  'HS256 was considered for simplicity. Rejected because any service with the secret can forge tokens — unacceptable in a multi-service environment. RS256 with a dedicated signing key is required.',
  { facts: ['HS256 rejected', 'any holder can forge tokens with HS256', 'RS256 required for multi-service'], concepts: ['JWT', 'HS256', 'RS256', 'security', 'token signing'], files: [] });

mem('negative_result', 'observation',
  'In-memory LRU cache replaced by Redis for multi-instance correctness',
  'Initially used an in-process LRU cache (lru-cache npm). Under horizontal scaling, each instance had a stale view. Cache invalidations on one instance were invisible to others. Replaced with Redis.',
  { facts: ['in-process cache breaks horizontal scaling', 'stale views across instances', 'replaced with Redis'], concepts: ['LRU cache', 'Redis', 'horizontal scaling', 'cache invalidation'], files: [] });

// decision (3)
mem('decision', 'manual',
  'Decision: PostgreSQL over MySQL for JSONB and full-text search',
  'Chose PostgreSQL over MySQL. Key reasons: native JSONB with indexing, built-in full-text search with tsvector, better support for complex queries and window functions. Team has deeper PostgreSQL expertise.',
  { facts: ['JSONB with indexing', 'tsvector full-text search', 'window functions', 'team expertise'], concepts: ['PostgreSQL', 'MySQL', 'JSONB', 'full-text search', 'database selection'], files: [] });

mem('decision', 'manual',
  'Decision: Bun runtime chosen over Node.js for TypeScript performance',
  'Bun was selected as the runtime. Native TypeScript execution without transpilation step, built-in SQLite, faster test runner, and 3x throughput on HTTP benchmarks. Risk: ecosystem maturity; mitigated by avoiding Bun-specific APIs in core logic.',
  { facts: ['native TS execution', 'built-in SQLite', '3x HTTP throughput', 'avoid Bun-specific APIs in core'], concepts: ['Bun', 'Node.js', 'TypeScript', 'runtime', 'performance'], files: [] });

mem('decision', 'manual',
  'Decision: TanStack Query over SWR and Redux Toolkit Query',
  'TanStack Query chosen for frontend data fetching. SWR lacks mutation invalidation patterns needed for complex writes. Redux Toolkit Query requires Redux store setup — adds boilerplate without benefit at current scale. TanStack Query wins on features-to-complexity ratio.',
  { facts: ['SWR lacks mutation invalidation', 'RTK Query requires Redux store', 'TanStack Query wins on features/complexity ratio'], concepts: ['TanStack Query', 'SWR', 'Redux', 'react-query', 'data fetching', 'React'], files: [] });

// ── Fixture queries ────────────────────────────────────────────────────────────

interface Fixture {
  query: string;
  expectedTopicInTop1: string; // what the top-1 result should be about
  relevantIds: number[];       // seq IDs of all clearly relevant memories
}

const FIXTURES: Fixture[] = [
  {
    query: 'JWT authentication RS256',
    expectedTopicInTop1: 'auth / JWT / RS256',
    relevantIds: [1, 9, 15, 23],
  },
  {
    query: 'PostgreSQL connection pool exhaustion',
    expectedTopicInTop1: 'database / PostgreSQL / connection pool',
    relevantIds: [2, 10, 16],
  },
  {
    query: 'Redis cache TTL expiry',
    expectedTopicInTop1: 'Redis cache / TTL',
    relevantIds: [3, 11, 16],
  },
  {
    query: 'rate limiting API sliding window',
    expectedTopicInTop1: 'rate limiting',
    relevantIds: [4, 13],
  },
  {
    query: 'circuit breaker payment service failure',
    expectedTopicInTop1: 'circuit breaker / payment',
    relevantIds: [5],
  },
  {
    query: 'React state management TanStack Query',
    expectedTopicInTop1: 'React / TanStack Query / state',
    relevantIds: [6, 14, 17, 25],
  },
  {
    query: 'Docker CI build image',
    expectedTopicInTop1: 'Docker / CI',
    relevantIds: [7, 18],
  },
  {
    query: 'Zod validation request body API boundary',
    expectedTopicInTop1: 'Zod / validation',
    relevantIds: [8, 12],
  },
];

const PASS_THRESHOLD = 6; // top-1 relevant on ≥6/8 queries

// ── Run queries ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  FTS5 Retrieval Quality Baseline — Aznex Issue #8');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  DB: in-memory SQLite | tokenizer: porter unicode61`);
console.log(`  Memories seeded: ${seq} | Fixture queries: ${FIXTURES.length}`);
console.log(`  Pass bar: top-1 relevant on ≥${PASS_THRESHOLD}/${FIXTURES.length} queries`);
console.log('══════════════════════════════════════════════════════════════\n');

let passes = 0;
const findings: { query: string; top1: string | null; relevant: boolean; matched: number; totalRelevant: number }[] = [];

for (const fixture of FIXTURES) {
  const results = memories.search(FP, fixture.query, 5);
  const top1 = results[0] ?? null;

  // Relevant = top-1 seq ID is in the fixture's relevantIds
  const top1Seq = top1 ? parseInt(top1.id.replace('m', ''), 10) : -1;
  const relevant = fixture.relevantIds.includes(top1Seq);

  // How many of the relevant IDs appear anywhere in top-5?
  const top5Seqs = new Set(results.map(r => parseInt(r.id.replace('m', ''), 10)));
  const matched = fixture.relevantIds.filter(id => top5Seqs.has(id)).length;

  if (relevant) passes++;

  findings.push({ query: fixture.query, top1: top1?.title ?? null, relevant, matched, totalRelevant: fixture.relevantIds.length });

  const mark = relevant ? '✓' : '✗';
  console.log(`${mark} "${fixture.query}"`);
  console.log(`  Expected: ${fixture.expectedTopicInTop1}`);
  if (results.length === 0) {
    console.log('  → NO RESULTS');
  } else {
    results.forEach((r, i) => {
      const seq = parseInt(r.id.replace('m', ''), 10);
      const isRel = fixture.relevantIds.includes(seq) ? ' ←relevant' : '';
      console.log(`  ${i + 1}. [${r.type}] ${r.title}${isRel}`);
    });
  }
  console.log(`  Relevant in top-5: ${matched}/${fixture.relevantIds.length} | Top-1 relevant: ${relevant ? 'YES' : 'NO'}`);
  console.log();
}

// ── Verdict ───────────────────────────────────────────────────────────────────

const passed = passes >= PASS_THRESHOLD;
console.log('══════════════════════════════════════════════════════════════');
console.log(`  VERDICT: ${passed ? '✓ PASS' : '✗ FAIL'} (${passes}/${FIXTURES.length} top-1 relevant, threshold ${PASS_THRESHOLD})`);
console.log('══════════════════════════════════════════════════════════════');

// ── Findings ──────────────────────────────────────────────────────────────────

console.log(`
FTS5 BEHAVIOUR NOTES (for quality gate decision):

1. Tokenizer: porter unicode61 — stems tokens, so "authentication" matches
   "authenticate", "authenticating", etc. Good for natural language queries.

2. Query builder (buildFtsQuery): wraps each whitespace-separated token in
   quotes, joining with implicit AND. Multi-word queries require ALL tokens
   to be present (stemmed) in a memory's indexed fields.

3. Ranking: results are ordered by updated_at_epoch DESC, NOT by BM25 rank.
   This means highly specific queries return the most-recently-updated
   matching memory first, not the most relevant one.

4. Index coverage: content, title, narrative, facts, concepts are all indexed.
   Adding keywords to concepts/facts dramatically improves recall.

5. Limitation: no semantic understanding — "fault tolerance" won't find
   "circuit breaker" unless both terms appear together in the memory text.
   Embeddings would close this gap.

RECOMMENDATION:
  ${passed
    ? `FTS5 passes the quality bar (${passes}/${FIXTURES.length}). Sufficient for v1 — ship with FTS5.\n  Monitor precision in production; add pgvector embeddings if semantic queries become a pain point.`
    : `FTS5 fails the quality bar (${passes}/${FIXTURES.length}). Consider adding embedding support\n  before full build, or improving seed quality (richer facts/concepts fields).`}
`);
