import fs from "node:fs";
import Database from "better-sqlite3";

export const migrationTableGroups = {
  configuration: [
    "applicationTenants",
    "facilityProfiles",
    "activitySessions",
    "activitySessionBookingConfigurations",
    "analyticsSurveyDefinitions",
    "analyticsSurveyQuestions",
    "analyticsSurveyCampaigns",
  ],
  operational: [
    "bookings",
    "bookingLifecycles",
    "bookingAnalyticsEvents",
    "waitlistEntries",
    "bookingReputations",
    "bookingReputationEvents",
    "activitySessionContents",
    "sessionContentProgress",
    "commercialTrials",
    "commercialTrialEvents",
    "commercialRequests",
    "facilityCommercialSubscriptions",
  ],
  identity: [
    "users",
    "administratorSignupProvisioning",
    "facilityMemberships",
    "facilityInvitations",
    "platformOperators",
    "corporateBootstrapState",
    "companyStaffProfiles",
    "corporateRoleAssignments",
    "corporateRoleDelegations",
    "managerOrganizationalUnits",
    "managerOrganizationalMemberships",
    "crmMemberProfiles",
    "crmFollowUps",
    "accountSupportIdentifiers",
    "accountDeletionPreferences",
    "accountDeletionRequests",
    "accountDeletionJobs",
    "accountDataDeletionDrafts",
    "accountRepresentatives",
    "delegationGrants",
    "socialProfiles",
    "internalContacts",
    "e2eeDevices",
    "e2eeOneTimePrekeys",
    "e2eeConversations",
    "e2eeEnvelopes",
    "e2eeAttachments",
    "communityChannels",
    "communityMessages",
    "communityAttachments",
    "communityMembers",
    "facilityLinks",
    "parentalControls",
    "moderationCases",
    "moderationActions",
    "moderationAppeals",
  ],
  retained: [
    "dataRetentionPolicies",
    "dataRetentionRecords",
    "billingRecords",
    "analyticsSurveyParticipations",
    "analyticsSurveyResponses",
    "analyticsSurveyAnswers",
    "stripeWebhookEvents",
    "commercialLifecycleFacts",
  ],
  security: [
    "emailVerificationChallenges",
    "emailChangeChallenges",
    "accountRecoveryChallenges",
    "accountDeletionChallenges",
    "emailDeliveries",
    "antiAutomationChallenges",
    "sessions",
    "mfaCredentials",
    "authChallenges",
    "passkeyCredentials",
    "webauthnChallenges",
    "securityEvents",
    "managerTemporaryPermissions",
  ],
  support: [
    "supportTickets",
    "supportAgents",
    "supportMessages",
    "supportAttachments",
    "supportEvents",
    "supportKnowledgeArticles",
    "umfSupportStaff",
    "umfSupportCollaborationSpaces",
    "umfSupportAccessRequests",
    "umfSupportAccessCredentials",
    "umfSupportTickets",
    "umfSupportMessages",
    "umfSupportMailDrafts",
    "umfSupportMailAttachments",
    "umfSupportNotificationPreferences",
    "umfSupportPushSubscriptions",
  ],
  feedback: ["feedback"],
} as const;

export const migratableTables = Object.values(migrationTableGroups).flat();

export interface DatabaseBridgeInspection {
  sourcePath: string;
  ready: boolean;
  missingTables: string[];
  rowCounts: Record<string, number>;
  groupCounts: Record<keyof typeof migrationTableGroups, number>;
  totalRows: number;
  containsSensitiveData: boolean;
}

export interface DatabaseMigrationPlan extends DatabaseBridgeInspection {
  targetProvider: "postgresql";
  executionEnabled: false;
  safeguards: string[];
  excludedByDefault: string[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function openSource(sourcePath: string): Database.Database {
  if (!fs.existsSync(sourcePath)) {
    throw new Error("The SQLite source database does not exist");
  }
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  source.pragma("foreign_keys = ON");
  return source;
}

export function inspectSqliteDatabase(
  sourcePath: string,
): DatabaseBridgeInspection {
  const source = openSource(sourcePath);
  try {
    const existing = new Set(
      (
        source
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    const missingTables = migratableTables.filter(
      (table) => !existing.has(table),
    );
    const rowCounts: Record<string, number> = {};
    let totalRows = 0;
    for (const table of migratableTables) {
      if (!existing.has(table)) continue;
      const result = source
        .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
        .get() as { count: number };
      rowCounts[table] = result.count;
      totalRows += result.count;
    }

    const groupCounts = Object.fromEntries(
      Object.entries(migrationTableGroups).map(([group, tables]) => [
        group,
        tables.reduce((total, table) => total + (rowCounts[table] ?? 0), 0),
      ]),
    ) as Record<keyof typeof migrationTableGroups, number>;

    return {
      sourcePath,
      ready: missingTables.length === 0,
      missingTables,
      rowCounts,
      groupCounts,
      totalRows,
      containsSensitiveData:
        groupCounts.identity +
          groupCounts.retained +
          groupCounts.security +
          groupCounts.support >
        0,
    };
  } finally {
    source.close();
  }
}

export function buildSqliteToPostgresMigrationPlan(
  sourcePath: string,
): DatabaseMigrationPlan {
  return {
    ...inspectSqliteDatabase(sourcePath),
    targetProvider: "postgresql",
    executionEnabled: false,
    safeguards: [
      "Verify the PostgreSQL target fingerprint and require an empty operational database.",
      "Take a restorable SQLite snapshot before any write operation.",
      "Run PostgreSQL migrations before copying application records.",
      "Copy inside a transaction and compare per-table row counts before commit.",
      "Require explicit operator approval for identity, billing and community data.",
    ],
    excludedByDefault: [
      "sessions",
      "authChallenges",
      "emailVerificationChallenges",
      "accountRecoveryChallenges",
      "emailDeliveries",
      "antiAutomationChallenges",
      "webauthnChallenges",
      "mfaCredentials",
      "passkeyCredentials",
      "platformOperators",
      "supportTickets",
      "supportAgents",
      "supportMessages",
      "supportAttachments",
      "supportEvents",
      "supportKnowledgeArticles",
      "umfSupportStaff",
      "umfSupportCollaborationSpaces",
      "umfSupportAccessRequests",
      "umfSupportAccessCredentials",
      "umfSupportTickets",
      "umfSupportMessages",
      "umfSupportMailDrafts",
      "umfSupportNotificationPreferences",
      "umfSupportPushSubscriptions",
    ],
  };
}
