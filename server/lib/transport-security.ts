import type { ConnectionOptions } from "node:tls";

// AES-GCM is preferred. ChaCha20-Poly1305 is retained as the only non-AES
// fallback for peers without suitable AES acceleration. Every suite is AEAD;
// CBC, RC4, 3DES and unauthenticated encryption are deliberately excluded.
export const MODERN_AEAD_TLS_CIPHERS = [
  "TLS_AES_256_GCM_SHA384",
  "TLS_AES_128_GCM_SHA256",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "DHE-RSA-AES256-GCM-SHA384",
  "DHE-RSA-AES128-GCM-SHA256",
].join(":");

export type AuthenticatedModernTlsOptions = Pick<
  ConnectionOptions,
  "minVersion" | "ciphers" | "rejectUnauthorized"
> & {
  rejectUnauthorized: true;
};

export function authenticatedModernTlsOptions(): AuthenticatedModernTlsOptions {
  return {
    minVersion: "TLSv1.2",
    ciphers: MODERN_AEAD_TLS_CIPHERS,
    rejectUnauthorized: true,
  };
}
