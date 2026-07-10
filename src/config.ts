/**
 * Plast ID-klient — konfiguration (env-drevet).
 *
 * Alle domæner/issuer kommer fra env, så et domæneskift er en env-ændring i appen,
 * ikke en kodeudrulning. Holdt rent (ingen better-auth-import) så det kan testes frit.
 */

export const PLAST_ID_PROVIDER_ID = "plast-id" as const;

/**
 * Separat provider-id for silent SSO (`prompt=none`). Better Auth udleder
 * callback-stien af providerId, så silent-flowet får sin egen redirect-URI —
 * registreret hos IdP'en side om side med den normale (eksakt match).
 */
export const PLAST_ID_SILENT_PROVIDER_ID = "plast-id-silent" as const;

export const DISCOVERY_PATH = "/api/auth/.well-known/openid-configuration";
export const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
export const AUDIT_INGEST_PATH = "/api/audit/ingest";
export const PROVISION_PATH = "/api/provision";
export const ROLES_LOOKUP_PATH = "/api/roles";
export const OAUTH_CALLBACK_PATH = "/api/auth/oauth2/callback/plast-id";
export const OAUTH_SILENT_CALLBACK_PATH = "/api/auth/oauth2/callback/plast-id-silent";

export interface PlastIdConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** App'ens eget audit-ingest-token (valgfrit; audit no-op uden det). */
  auditToken?: string;
  /** App'ens eget provision-token (valgfrit; dual-write no-op uden det). */
  provisionToken?: string;
}

type Env = Record<string, string | undefined>;

export function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Læs konfigurationen fra env (delvist — felter kan mangle). */
export function plastIdConfig(env: Env = process.env): Partial<PlastIdConfig> {
  return {
    issuer: env.PLAST_SSO_ISSUER ? trimSlash(env.PLAST_SSO_ISSUER) : undefined,
    clientId: env.PLAST_SSO_CLIENT_ID,
    clientSecret: env.PLAST_SSO_CLIENT_SECRET,
    auditToken: env.PLAST_AUDIT_TOKEN,
    provisionToken: env.PLAST_PROVISION_TOKEN,
  };
}

/** SSO er kun konfigureret når issuer + clientId + clientSecret alle er sat. */
export function isPlastIdConfigured(env: Env = process.env): boolean {
  const c = plastIdConfig(env);
  return Boolean(c.issuer && c.clientId && c.clientSecret);
}

export function discoveryUrl(issuer: string): string {
  return `${trimSlash(issuer)}${DISCOVERY_PATH}`;
}
export function authorizeUrl(issuer: string): string {
  return `${trimSlash(issuer)}${AUTHORIZE_PATH}`;
}
export function auditIngestUrl(issuer: string): string {
  return `${trimSlash(issuer)}${AUDIT_INGEST_PATH}`;
}
export function provisionUrl(issuer: string): string {
  return `${trimSlash(issuer)}${PROVISION_PATH}`;
}
