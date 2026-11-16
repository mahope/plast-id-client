/**
 * Plast ID-klient — den delte faglige profil (plast-id#122).
 *
 * Plast ID ejer profilen og udsteder den som claims i både ID-token og userinfo,
 * når appen beder om `profile`-scopet. Navnene her SKAL matche IdP'ens
 * (plast-id `src/lib/shared-profile.ts`, kontrakt i `docs/shared-profile.md`).
 *
 * `hcp_verified` er ALTID med, når scopet er givet. Dens tilstedeværelse betyder
 * "profilen blev udleveret", så et manglende felt dér betyder "tomt i Plast ID"
 * (appen rydder sit lokale felt). Mangler `hcp_verified`, gav tokenet ingen
 * profil, og `profileFromClaims` returnerer `null`: behold den lokale kopi.
 *
 * Rent og framework-agnostisk (ingen better-auth-import).
 */
import { decodeIdTokenClaims } from "./roles.js";

export const PLAST_ID_PROFILE_SCOPE = "profile" as const;
export const PLAST_ID_CLAIM_NAMESPACE = "https://plastid/claims/" as const;

/** Claim-navnene for profilen. Standard-claims har deres OIDC-navne. */
export const PLAST_ID_PROFILE_CLAIMS = {
  name: "name",
  picture: "picture",
  locale: "locale",
  updatedAt: "updated_at",
  title: `${PLAST_ID_CLAIM_NAMESPACE}title`,
  profession: `${PLAST_ID_CLAIM_NAMESPACE}profession`,
  specialty: `${PLAST_ID_CLAIM_NAMESPACE}specialty`,
  institution: `${PLAST_ID_CLAIM_NAMESPACE}institution`,
  country: `${PLAST_ID_CLAIM_NAMESPACE}country`,
  orcid: `${PLAST_ID_CLAIM_NAMESPACE}orcid`,
  hcpVerified: `${PLAST_ID_CLAIM_NAMESPACE}hcp_verified`,
} as const;

export const PLAST_ID_PROFESSIONS = ["surgeon", "trainee", "nurse", "student", "other"] as const;
export type PlastIdProfession = (typeof PLAST_ID_PROFESSIONS)[number];

export interface PlastIdProfile {
  name: string | null;
  /** https-URL eller null. */
  picture: string | null;
  /** BCP 47, fx "da" eller "en-GB". */
  locale: string | null;
  /** Fx "Dr." eller "Prof." (fri tekst). */
  title: string | null;
  profession: PlastIdProfession | null;
  specialty: string | null;
  institution: string | null;
  /** ISO 3166-1 alpha-2, store bogstaver. */
  country: string | null;
  /** Rent ORCID iD, 0000-0000-0000-000X. */
  orcid: string | null;
  hcpVerified: boolean;
  /** Hvornår et delt felt sidst blev ændret i Plast ID; null hvis aldrig. Sammenlign med den gemte værdi. */
  updatedAt: Date | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Map ID-token- eller userinfo-claims til en profil. `null` når claims ikke
 * indeholder profilen (intet `profile`-scope, eller IdP'en kunne ikke læse den):
 * så skal appen beholde sine lokale felter uændret.
 */
export function profileFromClaims(claims: Record<string, unknown> | null | undefined): PlastIdProfile | null {
  if (!claims || typeof claims[PLAST_ID_PROFILE_CLAIMS.hcpVerified] !== "boolean") return null;
  const c = PLAST_ID_PROFILE_CLAIMS;
  const profession = str(claims[c.profession]);
  const updatedAt = claims[c.updatedAt];
  return {
    name: str(claims[c.name]),
    picture: str(claims[c.picture]),
    locale: str(claims[c.locale]),
    title: str(claims[c.title]),
    profession: (PLAST_ID_PROFESSIONS as readonly string[]).includes(profession ?? "")
      ? (profession as PlastIdProfession)
      : null,
    specialty: str(claims[c.specialty]),
    institution: str(claims[c.institution]),
    country: str(claims[c.country]),
    orcid: str(claims[c.orcid]),
    hcpVerified: claims[c.hcpVerified] === true,
    updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? new Date(updatedAt * 1000) : null,
  };
}

/**
 * Profilen fra et gemt ID-token (account.idToken). Samme forbehold som
 * `rolesFromIdToken`: decode uden signaturtjek, kun på tokens fra egen database.
 */
export function profileFromIdToken(idToken: string | null | undefined): PlastIdProfile | null {
  return profileFromClaims(decodeIdTokenClaims(idToken));
}

/** Det en app kan seede tomme Plast ID-felter med (POST /api/provision/profile). */
export interface PlastIdProfileSeed {
  title?: string | null;
  /** Matches uden hensyn til store/små bogstaver; ukendte værdier afvises og listes i `rejected`. */
  profession?: string | null;
  specialty?: string | null;
  institution?: string | null;
  /** ISO-kode eller et engelsk/dansk landenavn. */
  country?: string | null;
  /** Rent iD eller orcid.org-URL. */
  orcid?: string | null;
  locale?: string | null;
  /** https-URL. */
  picture?: string | null;
  /** true sætter verifikationen én gang; false fjerner aldrig en. */
  hcpVerified?: boolean;
}

export interface PlastIdProfileSeedResult {
  ok: boolean;
  status: number;
  /** Felter der var tomme i Plast ID og nu har appens værdi. */
  seeded?: string[];
  /** Felter Plast ID allerede havde en værdi i (urørt). */
  kept?: string[];
  rejected?: { field: string; reason: string }[];
  /** Profilens `updated_at` (sekunder) efter kaldet, eller null. */
  updatedAt?: number | null;
}
