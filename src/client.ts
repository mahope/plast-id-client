/**
 * Plast ID-klient — client-side (Better Auth genericOAuth-client + login-helper).
 *
 * Importér i appens `auth-client.ts` og brug `signInWithPlastId` bag "Continue with
 * Plast ID"-knappen.
 */
import { genericOAuthClient } from "better-auth/client/plugins";
import { PLAST_ID_PROVIDER_ID } from "./config.js";

/** Plugin til createAuthClient({ plugins: [plastIdClientPlugin()] }). */
export function plastIdClientPlugin() {
  return genericOAuthClient();
}

/** Minimal form af det auth-client-stykke vi bruger (undgår en hård better-auth-typeafhængighed). */
interface OAuthSignInClient {
  signIn: {
    oauth2: (args: { providerId: string; callbackURL?: string }) => Promise<unknown>;
  };
}

/** Start Plast ID-login (redirect-flow). `callbackURL` er hvor brugeren lander efter login. */
export function signInWithPlastId(
  authClient: OAuthSignInClient,
  opts: { callbackURL?: string } = {},
): Promise<unknown> {
  return authClient.signIn.oauth2({
    providerId: PLAST_ID_PROVIDER_ID,
    callbackURL: opts.callbackURL ?? "/",
  });
}

export { PLAST_ID_PROVIDER_ID } from "./config.js";
