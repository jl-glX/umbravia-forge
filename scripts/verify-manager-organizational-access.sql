BEGIN READ ONLY;

SELECT
  'migration27' AS check_name,
  count(*) AS found,
  COALESCE(min("name"), '') AS migration_name
FROM "schemaMigrations"
WHERE "version" = 27;

SELECT
  'required_tables' AS check_name,
  count(*) AS found,
  3 AS expected
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'managerOrganizationalUnits',
    'managerOrganizationalMemberships',
    'managerTemporaryPermissions'
  );

SELECT
  'retired_browser_terminal' AS check_name,
  count(*) AS found,
  0 AS expected
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'managerTerminalAccess';

SELECT
  'invalid_active_memberships' AS check_name,
  count(*) AS total
FROM "managerOrganizationalMemberships" AS membership
LEFT JOIN "managerOrganizationalUnits" AS unit
  ON unit."id" = membership."unitId"
LEFT JOIN "users" AS account
  ON account."id" = membership."userId"
WHERE membership."status" = 'active'
  AND (unit."id" IS NULL OR account."id" IS NULL);

SELECT
  'invalid_temporary_permissions' AS check_name,
  count(*) AS total
FROM "managerTemporaryPermissions"
WHERE "expiresAt" <= "startsAt"
   OR (
     "status" = 'active'
     AND "expiresAt" <= (extract(epoch FROM clock_timestamp()) * 1000)::bigint
   );

ROLLBACK;
