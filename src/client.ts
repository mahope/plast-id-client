/**
 * Plast ID-klient — client-side (Better Auth genericOAuth-client + login-helper).
 *
 * Importér i appens `auth-client.ts` og brug `signInWithPlastId` bag "Continue with
 * Plast ID"-knappen.
 */
import * as clientPlugins from "better-auth/client/plugins";
import type { BetterAuthClientPlugin } from "better-auth";
import type { genericOAuth } from "better-auth/plugins";
import { PLAST_ID_PROVIDER_ID } from "./config.js";

type ClientFetch = Parameters<NonNullable<BetterAuthClientPlugin["getActions"]>>[0];
type FetchOptions = NonNullable<Parameters<ClientFetch>[1]>;

/** Plugin til createAuthClient({ plugins: [plastIdClientPlugin()] }). */
export function plastIdClientPlugin() {
  // Better Auth 1.7 folds Generic OAuth into the core social endpoints.
  const legacy = typeof Reflect.get(clientPlugins, "genericOAuthClient") === "function";
  return {
    id: "generic-oauth-client",
    $InferServerPlugin: {} as ReturnType<typeof genericOAuth>,
    getActions: ($fetch) => ({
      signIn: {
        oauth2: ({ providerId, fetchOptions: inputOptions, ...args }: {
          providerId: string;
          callbackURL?: string;
          errorCallbackURL?: string;
          newUserCallbackURL?: string;
          disableRedirect?: boolean;
          scopes?: string[];
          requestSignUp?: boolean;
          additionalData?: Record<string, unknown>;
          fetchOptions?: FetchOptions;
        }, fetchOptions: FetchOptions = {}) => $fetch(legacy ? "/sign-in/oauth2" : "/sign-in/social", {
          ...fetchOptions,
          ...inputOptions,
          method: "POST",
          body: legacy ? { providerId, ...args } : { provider: providerId, ...args },
        }),
      },
    }),
  } satisfies BetterAuthClientPlugin;
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
