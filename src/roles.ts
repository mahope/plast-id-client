/**
 * Plast ID-klient — centrale roller fra ID-token.
 *
 * Plast ID udsteder en `roles`-claim i ID-tokenet (RBAC, tier1b). Better Auth
 * gemmer ID-tokenet på account-rækken og opdaterer det ved HVERT login, så den
 * gemte token er den friskeste kilde til brugerens centrale roller — ingen
 * ekstra user-felter eller migrationer nødvendige.
 *
 * Decode sker UDEN signaturverifikation: tokenet kom fra IdP'ens token-endpoint
 * over TLS i et fortroligt server-til-server-exchange og er allerede betroet.
 * Brug det derfor KUN på tokens læst fra egen database (account.idToken) —
 * aldrig på tokens modtaget fra klienter.
 *
 * Rettighedsmodel: appens LOKALE rolle er autoritativ; centrale roller er
 * ADDITIVE (kan give adgang, aldrig fjerne den).
 */

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  // Node har Buffer; edge/browser har atob. Begge dækkes uden hård afhængighed.
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  if (typeof atob !== "undefined") return atob(padded);
  throw new Error("No base64 decoder available in this runtime");
}

/**
 * Decode payload-delen af et JWT. Returnerer `null` ved enhver malformethed
 * (fail-safe — en rådden token må aldrig vælte autorisation, blot give tom claim).
 */
export function decodeIdTokenClaims(idToken: string | null | undefined): Record<string, unknown> | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(base64UrlDecode(parts[1]!)) as unknown;
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Udtræk `roles`-claimen fra et gemt ID-token. Tom liste ved manglende/malformet token. */
export function rolesFromIdToken(idToken: string | null | undefined): string[] {
  const roles = decodeIdTokenClaims(idToken)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is string => typeof r === "string");
}

/**
 * Kombinér appens lokale rolle(r) med centrale Plast ID-roller til ét effektivt
 * rollesæt. Lokal er autoritativ, central er additiv — union, dedupe, og tomme/
 * ikke-strenge droppes. Sammenligning er case-sensitiv (roller er kanoniske slugs).
 */
export function resolveEffectiveRoles(
  localRoles: string | string[] | null | undefined,
  centralRoles: string[] | null | undefined,
): string[] {
  const local = (Array.isArray(localRoles) ? localRoles : localRoles ? [localRoles] : []);
  const central = Array.isArray(centralRoles) ? centralRoles : [];
  const out = new Set<string>();
  for (const r of [...local, ...central]) {
    if (typeof r === "string" && r.trim()) out.add(r.trim());
  }
  return [...out];
}

/** Har brugeren rollen — lokalt eller centralt? */
export function hasEffectiveRole(
  role: string,
  localRoles: string | string[] | null | undefined,
  centralRoles: string[] | null | undefined,
): boolean {
  return resolveEffectiveRoles(localRoles, centralRoles).includes(role);
}
