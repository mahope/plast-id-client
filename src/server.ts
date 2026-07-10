/**
 * Plast ID-klient — server-side (Better Auth `genericOAuth` + dual-write + roller + audit).
 *
 * Erstatter den copy-paste'ede SSO-glue i hver app. Importér i appens `auth.ts`.
 */
import { genericOAuth } from "better-auth/plugins";
import {
  PLAST_ID_PROVIDER_ID,
  PLAST_ID_SILENT_PROVIDER_ID,
  plastIdConfig,
  isPlastIdConfigured,
  discoveryUrl,
  auditIngestUrl,
  provisionUrl,
} from "./config.js";

type Env = Record<string, string | undefined>;

/**
 * Plast ID som OIDC-client. Returnerer en plugin-liste til betterAuth({ plugins })
 * — tom liste hvis SSO ikke er konfigureret (så appen kører videre på lokalt login).
 *
 * Registrerer to providers mod samme IdP-client:
 *  - `plast-id`        — normalt interaktivt login ("Fortsæt med Plast ID").
 *  - `plast-id-silent` — silent SSO (`prompt=none`): har brugeren en master-session
 *    hos IdP'en etableres lokal session uden interaktion; ellers svarer IdP'en med
 *    `error=login_required` (ikke en hård fejl — håndteres app-side).
 *
 * BEVIDST design: et succesfuldt silent login på en app hvor brugeren ikke findes
 * lokalt opretter (JIT-provisionerer) en lokal bruger uden interaktion — det er
 * suitens "én identitet, alle produkter"-model (IdP'en har skipConsent for trusted
 * clients af samme grund).
 */
export function plastIdServerPlugins(env: Env = process.env) {
  if (!isPlastIdConfigured(env)) return [];
  const c = plastIdConfig(env);
  const base = {
    clientId: c.clientId!,
    clientSecret: c.clientSecret!,
    discoveryUrl: discoveryUrl(c.issuer!),
    scopes: ["openid", "profile", "email"],
    pkce: true,
  };
  return [
    genericOAuth({
      config: [
        { providerId: PLAST_ID_PROVIDER_ID, ...base },
        { providerId: PLAST_ID_SILENT_PROVIDER_ID, ...base, prompt: "none" as const },
      ],
    }),
  ];
}

/**
 * Account-linking-config til betterAuth({ account: { accountLinking } }).
 * Gør BEGGE Plast ID-providers (normal + silent) til trusted providers og forbyder
 * linking på tværs af forskellige emails, så import-by-email + dual-write kobler til
 * en eksisterende lokal række (på samme email) frem for at lave en dublet.
 *
 * Silent-provideren SKAL være trusted: den repræsenterer præcis samme tillidsforhold
 * (samme clientId/secret/IdP), og uden den ville en brugers første silent login fejle
 * hårdt ("account not linked") når IdP-emailen ikke er verificeret.
 */
export const plastIdAccountLinking: {
  enabled: boolean;
  trustedProviders: string[];
  allowDifferentEmails: boolean;
} = {
  enabled: true,
  // Mutabel string[] (ikke readonly) — Better Auths accountLinking-type kræver det.
  trustedProviders: [PLAST_ID_PROVIDER_ID, PLAST_ID_SILENT_PROVIDER_ID],
  allowDifferentEmails: false,
};

/**
 * Udtræk roller fra Plast ID's `roles`-claim. GLOBAL/additiv: app-scoped roller
 * forbliver app-lokale og autoritative — denne må ikke overskrive dem. Tolerant
 * over for form (session.user, userinfo-claims, eller et rent objekt med `roles`).
 */
export function getPlastIdRoles(source: unknown): string[] {
  const roles = (source as { roles?: unknown } | null | undefined)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is string => typeof r === "string");
}

export interface ProvisionInput {
  email: string;
  name: string;
  /** Appens FAKTISKE verifikationstilstand — asserter aldrig true blindt. */
  emailVerified: boolean;
}
export interface ProvisionOutcome {
  ok: boolean;
  status: number;
  id?: string;
  created?: boolean;
}

/**
 * Dual-write: spejl en lokal identitet ind i den centrale Plast ID-bruger.
 * Fail-safe: kaster aldrig — en provision-fejl må ikke vælte appens signup.
 * No-op (ok:false, status:0) hvis issuer/provision-token mangler.
 */
export async function provisionToPlastId(
  input: ProvisionInput,
  opts: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<ProvisionOutcome> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const c = plastIdConfig(env);
  if (!c.issuer || !c.provisionToken) return { ok: false, status: 0 };
  try {
    const res = await doFetch(provisionUrl(c.issuer), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.provisionToken}`,
      },
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        emailVerified: input.emailVerified,
      }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = (await res.json().catch(() => ({}))) as { id?: string; created?: boolean };
    return { ok: true, status: res.status, id: json.id, created: json.created };
  } catch (err) {
    console.warn(`[plast-id-client] provision failed (non-fatal): ${(err as Error).message}`);
    return { ok: false, status: 0 };
  }
}

/**
 * Send et audit-event til den centrale audit-log. Fail-safe (kaster aldrig).
 * No-op hvis issuer/audit-token mangler. `event` skal overholde IdP'ens
 * audit-kontrakt (ingen rå PHI).
 */
export async function auditIngest(
  event: Record<string, unknown>,
  opts: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; status: number }> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const c = plastIdConfig(env);
  if (!c.issuer || !c.auditToken) return { ok: false, status: 0 };
  try {
    const res = await doFetch(auditIngestUrl(c.issuer), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.auditToken}`,
      },
      body: JSON.stringify(event),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn(`[plast-id-client] audit ingest failed (non-fatal): ${(err as Error).message}`);
    return { ok: false, status: 0 };
  }
}

export { PLAST_ID_PROVIDER_ID, isPlastIdConfigured } from "./config.js";
