import type {
  User, CreateUser,
  GithubInstallation, CreateGithubInstallation,
  Org, CreateOrg, OrgMembership, OrgRole,
  Repo, CreateRepo,
  RepoMember,
  ApiKey, CreateApiKey,
  Session, CreateSession,
  Memory, CreateMemory,
  MemoryAnchor,
  AgentEvent, CreateAgentEvent,
} from '@aznex/shared';

export interface IUserRepository {
  create(input: CreateUser): User;
  getById(id: string): User | null;
  getByGithubId(githubId: string): User | null;
  getByGithubLogin(login: string): User | null;
  update(id: string, input: Partial<CreateUser>): User | null;
}

export interface IGithubInstallationRepository {
  create(input: CreateGithubInstallation): GithubInstallation;
  getById(id: string): GithubInstallation | null;
  getByInstallationId(installationId: number): GithubInstallation | null;
  update(id: string, input: Partial<CreateGithubInstallation>): GithubInstallation | null;
}

export interface IOrgRepository {
  create(input: CreateOrg): Org;
  getById(id: string): Org | null;
  getBySlug(slug: string): Org | null;
  list(limit?: number): Org[];
  update(id: string, input: Partial<CreateOrg>): Org | null;
  setMember(orgId: string, login: string, role: OrgRole, invitedByLogin?: string | null): OrgMembership;
  getMember(orgId: string, login: string): OrgMembership | null;
  roleFor(orgId: string, login: string): OrgRole | null;
  listMembers(orgId: string): OrgMembership[];
  countAdmins(orgId: string): number;
  removeMember(orgId: string, login: string): void;
  listActiveForLogin(login: string): { org: Org; role: OrgRole }[];
}

export interface IRepoRepository {
  create(input: CreateRepo): Repo;
  getById(id: string): Repo | null;
  getByFingerprint(fingerprint: string): Repo | null;
  getActiveByFingerprint(fingerprint: string): Repo | null;
  update(id: string, input: Partial<CreateRepo>): Repo | null;
  listByOrgs(orgIds: string[], limit?: number): Repo[];
  list(limit?: number): Repo[];
}

export interface IApiKeyRepository {
  create(input: CreateApiKey): ApiKey;
  getById(id: string): ApiKey | null;
  getByHash(hash: string): ApiKey | null;
  listByUser(userId: string): ApiKey[];
  revoke(id: string): ApiKey | null;
  touchLastUsed(id: string, nowEpoch: number): void;
}

export interface IRepoMemberRepository {
  upsert(input: RepoMember): RepoMember;
  get(repoId: string, userId: string): RepoMember | null;
  listByRepo(repoId: string): RepoMember[];
  listByUser(userId: string): RepoMember[];
  delete(repoId: string, userId: string): void;
}

export interface ISessionRepository {
  create(input: CreateSession): Session;
  getById(id: string): Session | null;
  listByRepo(repoFingerprint: string, limit?: number): Session[];
  update(id: string, input: Partial<CreateSession>): Session | null;
}

export interface IMemoryRepository {
  create(input: CreateMemory): Memory;
  getById(id: string): Memory | null;
  update(id: string, input: Partial<CreateMemory>): Memory | null;
  listByRepo(repoFingerprint: string, limit?: number, offset?: number): Memory[];
  countByRepo(repoFingerprint: string): number;
  listBySession(sessionId: string): Memory[];
  search(repoFingerprint: string, query: string, limit?: number, offset?: number): Memory[];
  countSearch(repoFingerprint: string, query: string): number;
  delete(id: string): boolean;
}

export interface IMemoryAnchorRepository {
  upsert(anchor: MemoryAnchor): MemoryAnchor;
  listByMemory(memoryId: string): MemoryAnchor[];
  listByPath(path: string): MemoryAnchor[];
  delete(memoryId: string, path: string): void;
}

export interface IAgentEventRepository {
  create(input: CreateAgentEvent): AgentEvent;
  getById(id: string): AgentEvent | null;
  getByIdempotencyKey(key: string): AgentEvent | null;
  listByRepo(repoFingerprint: string, limit?: number): AgentEvent[];
  listBySession(sessionId: string): AgentEvent[];
}
