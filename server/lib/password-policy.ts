export const MIN_PASSWORD_CHARACTERS = 12;
export const MAX_PASSWORD_BYTES = 1_024;

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, "utf8");
}

export function isPasswordWithinHashLimit(password: string): boolean {
  return passwordByteLength(password) <= MAX_PASSWORD_BYTES;
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_CHARACTERS &&
    isPasswordWithinHashLimit(password) &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
