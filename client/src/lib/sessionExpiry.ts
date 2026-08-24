export function sessionExpiryKind(session: {
  idleExpiresAt: number;
  expiresAt: number;
}): "idle" | "absolute" {
  return session.idleExpiresAt <= session.expiresAt ? "idle" : "absolute";
}
