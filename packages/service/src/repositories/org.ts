import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import {
  OrgSchema, CreateOrgSchema, OrgMembershipSchema,
  type Org, type CreateOrg, type OrgMembership, type OrgRole,
} from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IOrgRepository } from './interfaces.js';

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

interface MembershipRow {
  org_id: string;
  github_login: string;
  role: string;
  invited_by_login: string | null;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: OrgRow): Org {
  return OrgSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

function mapMembership(row: MembershipRow): OrgMembership {
  return OrgMembershipSchema.parse({
    org_id: row.org_id,
    github_login: row.github_login,
    role: row.role,
    invited_by_login: row.invited_by_login,
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

// GitHub logins are case-insensitive; every read and write funnels through this
// so `Alice` and `alice` can never become two memberships.
function norm(login: string): string {
  return login.trim().toLowerCase();
}

export class OrgRepository implements IOrgRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateOrg): Org {
    const data = CreateOrgSchema.parse(input);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO org (id, slug, name, status, metadata, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.slug, data.name, data.status, stringifyJson(data.metadata), now, now);
    return this.getById(id)!;
  }

  getById(id: string): Org | null {
    const row = this.db.prepare('SELECT * FROM org WHERE id = ?').get(id) as OrgRow | null;
    return row ? mapRow(row) : null;
  }

  getBySlug(slug: string): Org | null {
    const row = this.db.prepare('SELECT * FROM org WHERE slug = ?').get(slug.toLowerCase()) as OrgRow | null;
    return row ? mapRow(row) : null;
  }

  list(limit = 200): Org[] {
    const rows = this.db
      .prepare('SELECT * FROM org ORDER BY created_at_epoch DESC LIMIT ?')
      .all(limit) as OrgRow[];
    return rows.map(mapRow);
  }

  update(id: string, input: Partial<CreateOrg>): Org | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const next = CreateOrgSchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE org SET slug = ?, name = ?, status = ?, metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(next.slug, next.name, next.status, stringifyJson(next.metadata), Date.now(), id);
    return this.getById(id);
  }

  // ── Membership ────────────────────────────────────────────────────────────

  setMember(orgId: string, login: string, role: OrgRole, invitedByLogin: string | null = null): OrgMembership {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO org_membership (org_id, github_login, role, invited_by_login, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id, github_login) DO UPDATE SET
        role = excluded.role,
        updated_at_epoch = excluded.updated_at_epoch
    `).run(orgId, norm(login), role, invitedByLogin ? norm(invitedByLogin) : null, now, now);
    return this.getMember(orgId, login)!;
  }

  getMember(orgId: string, login: string): OrgMembership | null {
    const row = this.db
      .prepare('SELECT * FROM org_membership WHERE org_id = ? AND github_login = ?')
      .get(orgId, norm(login)) as MembershipRow | null;
    return row ? mapMembership(row) : null;
  }

  roleFor(orgId: string, login: string): OrgRole | null {
    return this.getMember(orgId, login)?.role ?? null;
  }

  listMembers(orgId: string): OrgMembership[] {
    const rows = this.db
      .prepare('SELECT * FROM org_membership WHERE org_id = ? ORDER BY role, github_login')
      .all(orgId) as MembershipRow[];
    return rows.map(mapMembership);
  }

  countAdmins(orgId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM org_membership WHERE org_id = ? AND role = 'admin'")
        .get(orgId) as { n: number }
    ).n;
  }

  removeMember(orgId: string, login: string): void {
    this.db
      .prepare('DELETE FROM org_membership WHERE org_id = ? AND github_login = ?')
      .run(orgId, norm(login));
  }

  /** Active orgs this login belongs to, with its role. Suspended orgs are excluded
   *  everywhere on purpose: suspension must read as "no access", not "read-only". */
  listActiveForLogin(login: string): { org: Org; role: OrgRole }[] {
    const rows = this.db.prepare(`
      SELECT o.*, m.role AS member_role
      FROM org_membership m JOIN org o ON o.id = m.org_id
      WHERE m.github_login = ? AND o.status = 'active'
      ORDER BY o.name
    `).all(norm(login)) as (OrgRow & { member_role: string })[];
    return rows.map((row) => ({
      org: mapRow(row),
      role: OrgMembershipSchema.shape.role.parse(row.member_role),
    }));
  }
}
