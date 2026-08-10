import type Database from "better-sqlite3";

export function initializeE2eeSchema(sqliteDb: Database.Database) {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS e2eeDevices (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      clientDeviceId TEXT NOT NULL,
      registrationId INTEGER NOT NULL CHECK(registrationId BETWEEN 1 AND 16380),
      identityKey TEXT NOT NULL,
      signedPrekeyId INTEGER NOT NULL,
      signedPrekey TEXT NOT NULL,
      signedPrekeySignature TEXT NOT NULL,
      capabilityVersion TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastSeenAt INTEGER NOT NULL,
      revokedAt INTEGER,
      UNIQUE(userId, clientDeviceId),
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_e2eeDevices_user_active
      ON e2eeDevices(userId, revokedAt);

    CREATE TABLE IF NOT EXISTS e2eeOneTimePrekeys (
      deviceId TEXT NOT NULL,
      keyId INTEGER NOT NULL,
      publicKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      consumedAt INTEGER,
      consumedByDeviceId TEXT,
      PRIMARY KEY(deviceId, keyId),
      FOREIGN KEY(deviceId) REFERENCES e2eeDevices(id) ON DELETE CASCADE,
      FOREIGN KEY(consumedByDeviceId) REFERENCES e2eeDevices(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_e2eePrekeys_available
      ON e2eeOneTimePrekeys(deviceId, consumedAt, keyId);

    CREATE TABLE IF NOT EXISTS e2eeConversations (
      id TEXT PRIMARY KEY,
      participantAUserId TEXT NOT NULL,
      participantBUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      CHECK(participantAUserId < participantBUserId),
      UNIQUE(participantAUserId, participantBUserId),
      FOREIGN KEY(participantAUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(participantBUserId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_e2eeConversations_participantA
      ON e2eeConversations(participantAUserId, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_e2eeConversations_participantB
      ON e2eeConversations(participantBUserId, updatedAt DESC);

    CREATE TABLE IF NOT EXISTS e2eeEnvelopes (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      senderUserId TEXT NOT NULL,
      senderDeviceId TEXT NOT NULL,
      recipientUserId TEXT NOT NULL,
      recipientDeviceId TEXT NOT NULL,
      clientMessageId TEXT NOT NULL,
      envelopeType TEXT NOT NULL CHECK(envelopeType IN ('prekey', 'signal')),
      ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 1 AND 24576),
      associatedData TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      deliveredAt INTEGER,
      readAt INTEGER,
      expiresAt INTEGER,
      UNIQUE(senderDeviceId, clientMessageId, recipientDeviceId),
      FOREIGN KEY(conversationId) REFERENCES e2eeConversations(id) ON DELETE CASCADE,
      FOREIGN KEY(senderUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(senderDeviceId) REFERENCES e2eeDevices(id) ON DELETE CASCADE,
      FOREIGN KEY(recipientUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(recipientDeviceId) REFERENCES e2eeDevices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_e2eeEnvelopes_recipient
      ON e2eeEnvelopes(recipientDeviceId, createdAt, id);
    CREATE INDEX IF NOT EXISTS idx_e2eeEnvelopes_conversation
      ON e2eeEnvelopes(conversationId, createdAt, id);

    CREATE TABLE IF NOT EXISTS e2eeAttachments (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      senderUserId TEXT NOT NULL,
      senderDeviceId TEXT NOT NULL,
      recipientUserId TEXT NOT NULL,
      recipientDeviceId TEXT NOT NULL,
      clientAttachmentId TEXT NOT NULL,
      storageKey TEXT NOT NULL UNIQUE,
      sizeBytes INTEGER NOT NULL CHECK(sizeBytes > 0),
      checksumSha256 TEXT NOT NULL,
      associatedData TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      downloadedAt INTEGER,
      expiresAt INTEGER,
      UNIQUE(senderDeviceId, clientAttachmentId, recipientDeviceId),
      FOREIGN KEY(conversationId) REFERENCES e2eeConversations(id) ON DELETE CASCADE,
      FOREIGN KEY(senderUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(senderDeviceId) REFERENCES e2eeDevices(id) ON DELETE CASCADE,
      FOREIGN KEY(recipientUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(recipientDeviceId) REFERENCES e2eeDevices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_e2eeAttachments_recipient
      ON e2eeAttachments(recipientDeviceId, createdAt, id);
    CREATE INDEX IF NOT EXISTS idx_e2eeAttachments_conversation
      ON e2eeAttachments(conversationId, createdAt, id);
  `);
}
