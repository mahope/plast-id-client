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

/* ------------------------------------------------------------------ */
/* Browser-wiring: one-shot silent-forsøg via Better Auth-klienten     */
/* ------------------------------------------------------------------ */

/** Guard-cookiens navn (deler navn med query-param-guarden). */
export const SILENT_GUARD_COOKIE = SILENT_GUARD_PARAM;

/** Standard-TTL for guarden: ét silent-forsøg pr. 10 minutter pr. browser. */
export const SILENT_GUARD_MAX_AGE_SECONDS = 600;

/** Ren helper: er guard-cookien sat i en `document.cookie`-streng? */
export function hasSilentGuard(cookieString: string): boolean {
  return cookieString
    .split(";")
    .some((c) => c.trim().startsWith(`${SILENT_GUARD_COOKIE}=`));
}

/** Ren helper: byg guard-cookiens `Set-Cookie`-værdi (sættes via document.cookie). */
export function silentGuardCookie(maxAgeSeconds: number = SILENT_GUARD_MAX_AGE_SECONDS): string {
  return `${SILENT_GUARD_COOKIE}=1; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

/** Minimal form af auth-klienten (undgår hård better-auth-typeafhængighed). */
export interface SilentSSOAuthClient {
  signIn: {
    oauth2: (args: {
      providerId: string;
      callbackURL?: string;
      errorCallbackURL?: string;
    }) => Promise<unknown>;
  };
}

export interface AttemptSilentSSOOptions {
  /** Hvor brugeren lander efter et succesfuldt silent login. Default: nuværende URL. */
  returnTo?: string;
  /** Guard-TTL i sekunder. Default 600. */
  guardMaxAgeSeconds?: number;
  /** Har brugeren allerede en lokal session? (fra useSession e.l.) */
  hasLocalSession: boolean;
}

/**
 * Forsøg silent SSO fra browseren — one-shot. Returnerer `true` hvis et forsøg
 * blev startet (siden navigerer væk til IdP'en), ellers `false` (no-op).
 *
 * VIGTIGT (better-auth 1.6): ved IdP-fejl (`login_required`) redirecter callback-
 * routen til den GLOBALE `onAPIError.errorURL` — IKKE `errorCallbackURL` herfra.
 * Appen skal derfor pege `onAPIError.errorURL` på en route der tolker
 * `error=login_required` som "ikke logget ind" og sender brugeren stille videre.
 */
export async function attemptSilentSSO(
  authClient: SilentSSOAuthClient,
  opts: AttemptSilentSSOOptions,
): Promise<boolean> {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (
    !shouldAttemptSilentAuth({
      hasLocalSession: opts.hasLocalSession,
      alreadyAttempted: hasSilentGuard(document.cookie),
      isLoginRequiredCallback: isLoginRequiredError(
        new URLSearchParams(window.location.search),
      ),
    })
  ) {
    return false;
  }
  document.cookie = silentGuardCookie(opts.guardMaxAgeSeconds);
  await authClient.signIn.oauth2({
    providerId: "plast-id-silent",
    callbackURL: opts.returnTo ?? window.location.href,
  });
  return true;
}
