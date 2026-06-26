/**
 * Plast ID-klient — embedded/silent SSO (SP1b).
 *
 * Ægte cross-domain SSO uden synlig login-formular: når brugeren rammer en app uden
 * lokal session, forsøges silent auth som TOP-LEVEL navigation (ikke iframe) mod IdP'ens
 * authorize-endpoint med `prompt=none`. Har brugeren en master-session → `code` →
 * lokal session etableres. Ellers → `error=login_required` → vis embedded login (IKKE
 * en hård fejl). One-shot loop-guard forhindrer redirect-løkker.
 *
 * Kernen her er ren/testbar; selve redirecten + cookie-flag wires app-side.
 */
import { authorizeUrl } from "./config.js";

/** Kortlivet flag (query/cookie) der markerer at silent auth allerede er forsøgt. */
export const SILENT_GUARD_PARAM = "plastid_silent";

export interface SilentAuthUrlInput {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

/** Byg authorize-URL'en til silent auth (`prompt=none`, top-level navigation). */
export function buildSilentAuthUrl(input: SilentAuthUrlInput): string {
  const u = new URL(authorizeUrl(input.issuer));
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("prompt", "none");
  u.searchParams.set("state", input.state);
  return u.toString();
}

export interface SilentAuthGuardInput {
  /** Har brugeren allerede en lokal første-parts-session? */
  hasLocalSession: boolean;
  /** Er silent auth allerede forsøgt i dette app-load (guard-flag sat)? */
  alreadyAttempted: boolean;
  /** Kom vi netop tilbage med `error=login_required` fra et silent-forsøg? */
  isLoginRequiredCallback: boolean;
}

/**
 * Afgør om silent auth skal forsøges. Forsøg KUN når der ikke er en lokal session,
 * det ikke allerede er forsøgt, og vi ikke netop fik `login_required` — så en bruger
 * uden master-session ikke bouncer i ring.
 */
export function shouldAttemptSilentAuth(input: SilentAuthGuardInput): boolean {
  if (input.hasLocalSession) return false;
  if (input.alreadyAttempted) return false;
  if (input.isLoginRequiredCallback) return false;
  return true;
}

/** Tolk IdP'ens silent-callback: en `login_required`-fejl betyder "ikke logget ind", ikke en hård fejl. */
export function isLoginRequiredError(params: URLSearchParams): boolean {
  return params.get("error") === "login_required";
}
