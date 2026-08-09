import type Database from "better-sqlite3";

export function initializeCommunitySchema(sqliteDb: Database.Database) {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS socialProfiles (
      userId TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      bio TEXT NOT NULL DEFAULT '',
      displayRealName INTEGER NOT NULL DEFAULT 0 CHECK(displayRealName IN (0, 1)),
      birthDate TEXT,
      privacy TEXT NOT NULL DEFAULT '{}',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_socialProfiles_username ON socialProfiles(username);

    CREATE TABLE IF NOT EXISTS internalContacts (
      id TEXT PRIMARY KEY,
      requesterUserId TEXT NOT NULL,
      recipientUserId TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('contact_requested','contact_accepted','contact_rejected','contact_blocked','contact_removed')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      CHECK(requesterUserId <> recipientUserId),
      FOREIGN KEY(requesterUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(recipientUserId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_internalContacts_pair
      ON internalContacts(
        CASE WHEN requesterUserId < recipientUserId THEN requesterUserId ELSE recipientUserId END,
        CASE WHEN requesterUserId < recipientUserId THEN recipientUserId ELSE requesterUserId END
      );
    CREATE INDEX IF NOT EXISTS idx_internalContacts_user_status
      ON internalContacts(requesterUserId, recipientUserId, status);

    CREATE TABLE IF NOT EXISTS communityChannels (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('facility','class','community')),
      scopeId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('community_active','community_read_only','community_suspended','community_closed')),
      createdBy TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(createdBy) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_communityChannels_scope
      ON communityChannels(scope, scopeId, name);

    CREATE TABLE IF NOT EXISTS communityMembers (
      channelId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','member')),
      createdAt INTEGER NOT NULL,
      PRIMARY KEY(channelId, userId),
      FOREIGN KEY(channelId) REFERENCES communityChannels(id) ON DELETE CASCADE,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_communityMembers_user
      ON communityMembers(userId, channelId);

    CREATE TABLE IF NOT EXISTS communityMessages (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      authorUserId TEXT NOT NULL,
      parentId TEXT,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
      protectedBody TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('public','private_justification')),
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','reported','removed')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(channelId) REFERENCES communityChannels(id) ON DELETE CASCADE,
      FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(parentId) REFERENCES communityMessages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_communityMessages_channel
      ON communityMessages(channelId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS facilityLinks (
      id TEXT PRIMARY KEY,
      sourceFacilityId TEXT NOT NULL,
      targetFacilityName TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL CHECK(mode IN ('temporary','permanent')),
      sharedSpaces TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('facility_link_requested','facility_link_accepted','facility_link_rejected','facility_link_active','facility_link_suspended','facility_link_expired','facility_link_terminated')),
      expiresAt INTEGER,
      createdBy TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(createdBy) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS parentalControls (
      id TEXT PRIMARY KEY,
      childUserId TEXT NOT NULL,
      guardianUserId TEXT NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK(status IN ('parental_control_inactive','parental_control_pending','parental_control_active','parental_control_under_review','parental_control_transitioning','parental_control_ended')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(childUserId, guardianUserId),
      FOREIGN KEY(childUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(guardianUserId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS moderationCases (
      id TEXT PRIMARY KEY,
      reporterUserId TEXT NOT NULL,
      subjectUserId TEXT,
      messageId TEXT,
      facilityId TEXT NOT NULL DEFAULT 'primary',
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      urgency TEXT NOT NULL CHECK(urgency IN ('normal','high','critical')),
      status TEXT NOT NULL CHECK(status IN ('open','in_review','resolved','rejected','appeal_open')),
      resolution TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(reporterUserId) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(subjectUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(messageId) REFERENCES communityMessages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_moderationCases_status
      ON moderationCases(status, urgency, createdAt DESC);

    CREATE TABLE IF NOT EXISTS moderationActions (
      id TEXT PRIMARY KEY,
      caseId TEXT NOT NULL,
      actorUserId TEXT NOT NULL,
      subjectUserId TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('unrestricted','muted','removed_from_chat','temporarily_blocked','blocked_by_facility','under_central_review','appeal_open','platform_suspended')),
      reason TEXT NOT NULL,
      durationMinutes INTEGER,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(caseId) REFERENCES moderationCases(id) ON DELETE CASCADE,
      FOREIGN KEY(actorUserId) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(subjectUserId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_moderationActions_subject
      ON moderationActions(subjectUserId, createdAt DESC);

    CREATE TABLE IF NOT EXISTS moderationAppeals (
      id TEXT PRIMARY KEY,
      caseId TEXT NOT NULL,
      appellantUserId TEXT NOT NULL,
      context TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('open','accepted','rejected')),
      resolution TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(caseId) REFERENCES moderationCases(id) ON DELETE CASCADE,
      FOREIGN KEY(appellantUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_moderationAppeals_case
      ON moderationAppeals(caseId, status, createdAt DESC);
  `);

  const messageColumns = sqliteDb
    .prepare("PRAGMA table_info(communityMessages)")
    .all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "protectedBody")) {
    sqliteDb.exec(
      "ALTER TABLE communityMessages ADD COLUMN protectedBody TEXT",
    );
  }
}
