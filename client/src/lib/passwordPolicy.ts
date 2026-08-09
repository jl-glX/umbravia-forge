export const MAX_PASSWORD_BYTES = 1_024;

export function isPasswordWithinHashLimit(password: string): boolean {
  return new TextEncoder().encode(password).length <= MAX_PASSWORD_BYTES;
}
