export const COMMERCIAL_APPLICATION_TENANT_ID = "commercial" as const;
export const CORPORATE_SUPPORT_APPLICATION_TENANT_ID =
  "corporate-support" as const;

export const APPLICATION_TENANT_IDS = [
  COMMERCIAL_APPLICATION_TENANT_ID,
  CORPORATE_SUPPORT_APPLICATION_TENANT_ID,
] as const;

export type ApplicationTenantId = (typeof APPLICATION_TENANT_IDS)[number];

/**
 * Support records are owned by the corporate support product. The commercial
 * application may submit and read requester-visible records only through its
 * narrow support bridge; it never becomes the owner of the operational data.
 */
export const SUPPORT_DATA_APPLICATION_TENANT_ID =
  CORPORATE_SUPPORT_APPLICATION_TENANT_ID;
