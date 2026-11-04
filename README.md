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
  "@mahope/plast-id-client": "github:mahope/plast-id-client#v0.4.0"
}
```

`prepare`-scriptet bygger pakken (`tsc`) ved install, så `dist/` er klar i app'ens build.

> **better-auth peer-dep:** `>=1.2.8`. CI tester 1.2.8, 1.6.30 og 1.7.15.
> 1.6.30 indgår kun som kompatibilitetskontrol. Brug en rettet 1.7.x (mindst 1.7.7)
> ved sikkerhedsopgraderingen. Eksemplet ovenfor er det seneste udgivne tag;
> Better Auth 1.7 i forbrugerappen kræver den foreslåede SDK-patch 0.4.1.

## Opgradering til Better Auth 1.7

SDK 0.4.0 virker ikke uændret med Better Auth 1.7 i forbrugerappen:
`genericOAuthClient` er fjernet. Patch 0.4.1 bevarer SDK'ets `signIn.oauth2`-API
(og dermed `signInWithPlastId` og `attemptSilentSSO`), men bruger `signIn.social`
på 1.7. På 1.2/1.6 bruges de hidtidige ruter.

Registrér begge nye callback-URI'er hos Plast ID, før forbrugerappen opgraderes:
`https://APP/api/auth/callback/plast-id` og
`https://APP/api/auth/callback/plast-id-silent`. Behold de gamle
`/api/auth/oauth2/callback/...` under overgangen og til rollback.
SDK'ets `OAUTH_CALLBACK_PATH` og `OAUTH_SILENT_CALLBACK_PATH` er fortsat de gamle
1.6-stier. Manuelt konfigurerede redirect-URI'er skal tilpasses appens Better Auth-version.
Behold appens eget cookie-præfiks.

På IdP'en skal `validAudiences` flyttes til `resources`, med tilhørende
klientregistreringer og schema-migration. SDK'et bruger almindelig OIDC-login med
`openid profile email` og sender ingen `resource`: ID-tokenets `aud` er klient-id'et,
ikke en beskyttet API-resource. API-adgang med resource-bundne access tokens er en
separat kontrakt; bed om samme resource ved authorize og token exchange, hvis den tilføjes.

**Issuer-backfill:** 1.7.0–1.7.2 krævede en ny `account.issuer`-kolonne og backfill.
Fra 1.7.3 er kontonøglen igen `(providerId, accountId)`. En direkte opgradering fra
1.6 til 1.7.15 kræver derfor ingen issuer-backfill, hverken hos IdP eller forbruger.
Har databasen været på 1.7.0–1.7.2, skal et efterladt `issuer NOT NULL`-krav og
issuer-indeks håndteres før login; følg upstream-guiden med de faktiske kolonnenavne.

Kontrollér discovery-issuer, JWKS, klient-id som ID-token-audience og UserInfo.
Integrationsprøven bruger signerede ID-tokens uden profil/email og læser dem fra UserInfo.
SurgAI skal opdatere sin vendorede kopi i `vendor/plast-id-client`, når patchen godkendes.
Forbrugernes migrationer og live login er ikke udført i dette repo.

Kilder: [1.7-opgraderingsguide](https://better-auth.com/docs/guides/1-7-upgrade-guide),
[kontoændringen fra 1.7.3](https://better-auth.com/blog/1-7-account-schema),
[GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm).

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
import { plastIdServerPlugins, plastIdAccountLinking, plastIdCookiePrefix, provisionToPlastId } from "@mahope/plast-id-client/server";

export const auth = betterAuth({
  account: { accountLinking: plastIdAccountLinking },
  // Påkrævet hvis appen deler cookie-domæne med resten af suiten (crossSubDomainCookies).
  // Better Auth's default cookiePrefix ("better-auth") ville ellers kollidere med IdP'ens
  // egen session-cookie — plastIdServerPlugins() inkluderer et guard-plugin der fejler
  // hårdt ved boot hvis crossSubDomainCookies er slået til uden dette sat.
  advanced: { cookiePrefix: plastIdCookiePrefix() },
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
npm ci --ignore-scripts --legacy-peer-deps
npm test        # vitest
npm run build   # tsc -> dist/
npm run typecheck
```

Byg eksplicit efter `--ignore-scripts`, da `prepare` ikke køres. `--legacy-peer-deps`
undgår npm 10's konflikt mellem Better Auths valgfrie SvelteKit-peer og Vitest/Vite;
SDK'et bruger ingen SvelteKit-integration. Ved ændring af lockfilen køres
`node scripts/check-release-age.mjs` før installation. Alle låste versioner skal være
mindst tre døgn gamle. CI gør dette for hver Better Auth-version før `npm ci`.
Der er intet lint-script i repoet.
