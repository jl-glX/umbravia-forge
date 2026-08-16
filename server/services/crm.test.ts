import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("facility CRM isolation and privacy boundaries", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let crm: typeof import("./crm.js");
  const now = Date.UTC(2026, 7, 16, 12);

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-crm-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    crm = await import("./crm.js");
    await database.initializeDatabase();

    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "crm-secondary",
        slug: "crm-secondary",
        name: "CRM Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "crm-secondary-admin",
          email: "crm-admin@example.com",
          phone: null,
          name: "CRM Admin",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "crm-secondary-member",
          email: "crm-member@example.com",
          phone: null,
          name: "CRM Member",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "member",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "crm-secondary:admin",
          facilityId: "crm-secondary",
          userId: "crm-secondary-admin",
          role: "admin",
          status: "active",
          createdAt: now - 90 * 86_400_000,
          updatedAt: now,
        },
        {
          id: "crm-secondary:member",
          facilityId: "crm-secondary",
          userId: "crm-secondary-member",
          role: "member",
          status: "active",
          createdAt: now - 10 * 86_400_000,
          updatedAt: now,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("returns only members and assignees from the requested facility", async () => {
    const workspace = await crm.getCrmWorkspace("crm-secondary", now);

    expect(workspace.members).toEqual([
      expect.objectContaining({
        userId: "crm-secondary-member",
        suggestedSegment: "onboarding",
        effectiveSegment: "onboarding",
      }),
    ]);
    expect(workspace.assignees).toEqual([
      expect.objectContaining({ userId: "crm-secondary-admin", role: "admin" }),
    ]);
    expect(JSON.stringify(workspace)).not.toContain("survey");
    expect(JSON.stringify(workspace)).not.toContain("response");
  });

  it("rejects members and assignees belonging to another facility", async () => {
    await expect(
      crm.updateCrmMemberProfile({
        facilityId: "primary",
        memberUserId: "crm-secondary-member",
        updatedByUserId: "admin",
        manualSegment: "attention",
        assignedToUserId: null,
        nextFollowUpAt: null,
        now,
      }),
    ).rejects.toMatchObject({ code: "CRM_MEMBER_NOT_FOUND", status: 404 });

    await expect(
      crm.updateCrmMemberProfile({
        facilityId: "crm-secondary",
        memberUserId: "crm-secondary-member",
        updatedByUserId: "crm-secondary-admin",
        manualSegment: "attention",
        assignedToUserId: "admin",
        nextFollowUpAt: now + 86_400_000,
        now,
      }),
    ).rejects.toMatchObject({ code: "CRM_ASSIGNEE_INVALID", status: 400 });
  });

  it("keeps follow-ups inside their facility and updates the member segment", async () => {
    await crm.updateCrmMemberProfile({
      facilityId: "crm-secondary",
      memberUserId: "crm-secondary-member",
      updatedByUserId: "crm-secondary-admin",
      manualSegment: "attention",
      assignedToUserId: "crm-secondary-admin",
      nextFollowUpAt: now + 86_400_000,
      now,
    });
    await crm.createCrmFollowUp({
      facilityId: "crm-secondary",
      memberUserId: "crm-secondary-member",
      assignedToUserId: "crm-secondary-admin",
      kind: "check_in",
      dueAt: now + 86_400_000,
      createdByUserId: "crm-secondary-admin",
      now,
    });

    const secondary = await crm.getCrmWorkspace("crm-secondary", now);
    expect(secondary.members[0]).toMatchObject({
      effectiveSegment: "attention",
      openFollowUps: 1,
    });
    expect(secondary.followUps).toHaveLength(1);

    const primary = await crm.getCrmWorkspace("primary", now);
    expect(primary.followUps).toHaveLength(0);
    expect(primary.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "crm-secondary-member" }),
      ]),
    );
  });
});
