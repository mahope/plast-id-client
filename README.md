# @mahope/plast-id-client

Delt Plast ID SSO-klient for Mahope-produktsuiten (PlastSurgeon, JPBRS, Plastnurse, SurgAI).
Samler den SSO-glue der ellers er copy-paste'et i hvert app-repo ét sted: OIDC-client,
account-linking, dual-write, roller-claim, audit-ingest og embedded/silent SSO.

## Installation

Konsumeres som git-dependency med tag-pinning (ingen separat npm-registry — app-repoerne har
allerede privat GitHub-adgang i deres Docker-build):

```jsonc
// app'ens package.json
"dependencies": {
  "@mahope/plast-id-client": "github:mahope/plast-id-client#v0.1.0"
}
```

`prepare`-scriptet bygger pakken (`tsc`) ved install, så `dist/` er klar i app'ens build.

> **better-auth peer-dep:** `>=1.2.8`. Suiten kører pt. på 1.2.8 (plast-id, plastsurgeon),
> 1.3.34 (jpbrs) og 1.4.18 (surgai) — bør alignes (se identitets-sync-spec, "Tværgående").

## Env

```bash
PLAST_SSO_ISSUER=https://id.mahoje.dk      # kanonisk IdP-domæne (skift = env-ændring)
PLAST_SSO_CLIENT_ID=plastsurgeon           # appens client_id
PLAST_SSO_CLIENT_SECRET=...                # appens client secret
PLAST_PROVISION_TOKEN=...                  # appens provision-token (dual-write; valgfri)
PLAST_AUDIT_TOKEN=...                       # appens audit-ingest-token (valgfri)
```

## Brug

```ts
// auth.ts (server)
import { plastIdServerPlugins, plastIdAccountLinking, provisionToPlastId } from "@mahope/plast-id-client/server";

export const auth = betterAuth({
  account: { accountLinking: plastIdAccountLinking },
  plugins: [...plastIdServerPlugins(), nextCookies()],
  databaseHooks: {
    user: { create: { after: async (user) => {
      // dual-write (identitets-only, fail-safe): spejl signup til central Plast ID
      await provisionToPlastId({ email: user.email, name: user.name, emailVerified: user.emailVerified });
    }}},
  },
});
```

```ts
// auth-client.ts (client)
import { plastIdClientPlugin, signInWithPlastId } from "@mahope/plast-id-client/client";
export const authClient = createAuthClient({ plugins: [plastIdClientPlugin()] });
// knap: onClick={() => signInWithPlastId(authClient, { callbackURL: "/dashboard" })}
```

```ts
// silent SSO (SP1b) — top-level prompt=none bounce med loop-guard
import { buildSilentAuthUrl, shouldAttemptSilentAuth, isLoginRequiredError } from "@mahope/plast-id-client/silent";
```

## Udvikling

```bash
npm install
npm test        # vitest
npm run build   # tsc -> dist/
```
