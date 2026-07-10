/**
 * Plast ID-klient — centrale roller fra ID-token.
 *
 * Plast ID udsteder en `roles`-claim i ID-tokenet (RBAC, tier1b). Better Auth
 * gemmer ID-tokenet på account-rækken og opdaterer det ved hvert login — men
 * PR. PROVIDER: normalt login opdaterer `plast-id`-rækken, silent login
 * `plast-id-silent`-rækken. Læs derfor ALTID på tværs af begge provider-ids og
 * vælg den senest opdaterede række — brug `freshestIdToken()` frem for at slå
 * en enkelt providerId op. Ingen ekstra user-felter eller migrationer nødvendige.
 *
 * STALENESS (kendt, accepteret indtil videre — plast-id#12): claimen er kun så
 * frisk som brugerens SENESTE OIDC-login i appen. Central tilbagekaldelse slår
 * først igennem ved næste re-auth; med rullende lokale sessioner kan det for en
 * aktiv bruger være længe. Bounded revocation (live roles-endpoint eller
 * alders-cap + silent re-auth) er planlagt i plast-id#12.
 *
 * Decode sker UDEN signaturverifikation: tokenet kom fra IdP'ens token-endpoint
 * over TLS i et fortroligt server-til-server-exchange og er allerede betroet.
 * Brug det derfor KUN på tokens læst fra egen database (account.idToken) —
 * aldrig på tokens modtaget fra klienter.
 *
 * Rettighedsmodel: appens LOKALE rolle er autoritativ; centrale roller er
 * ADDITIVE (kan give adgang, aldrig fjerne den).
 */
import { PLAST_ID_PROVIDER_ID, PLAST_ID_SILENT_PROVIDER_ID } from "./config.js";

/** Begge provider-ids der repræsenterer Plast ID-identiteten i account-tabellen. */
export const PLAST_ID_PROVIDER_IDS: readonly string[] = [
  PLAST_ID_PROVIDER_ID,
  PLAST_ID_SILENT_PROVIDER_ID,
];

/** Minimal form af en Better Auth account-række som vi behøver den. */
export interface PlastIdAccountLike {
  providerId: string;
  idToken?: string | null;
  updatedAt?: Date | string | null;
}

/**
 * Vælg det friskeste Plast ID-idToken blandt en brugers account-rækker.
 * Filtrerer til Plast ID-providers (normal + silent), kræver et idToken, og
 * vælger den senest opdaterede række. `null` hvis ingen kandidater.
 */
export function freshestIdToken(accounts: PlastIdAccountLike[]): string | null {
  const ts = (a: PlastIdAccountLike) => {
    const d = a.updatedAt instanceof Date ? a.updatedAt : a.updatedAt ? new Date(a.updatedAt) : null;
    return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  };
  const candidates = accounts
    .filter((a) => PLAST_ID_PROVIDER_IDS.includes(a.providerId) && a.idToken)
    .sort((a, b) => ts(b) - ts(a));
  return candidates[0]?.idToken ?? null;
}

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

/**
 * Udled de roller der gælder for ÉN app fra Plast ID's roles-claim.
 * Claim-format (IdP'ens buildRolesClaim): globale roller som bar slug
 * ("admin"), app-scoped som "role:appId" ("editor:jpbrs"). Returnerer
 * globale + denne apps scoped roller, med scope strippet og deduperet.
 */
export function centralRolesForApp(claim: string[] | null | undefined, appId: string): string[] {
  if (!Array.isArray(claim)) return [];
  const out = new Set<string>();
  for (const entry of claim) {
    if (typeof entry !== "string" || !entry) continue;
    const idx = entry.indexOf(":");
    if (idx === -1) {
      out.add(entry); // global
    } else if (entry.slice(idx + 1) === appId) {
      const role = entry.slice(0, idx);
      if (role) out.add(role);
    }
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
