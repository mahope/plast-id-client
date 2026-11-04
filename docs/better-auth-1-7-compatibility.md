# Better Auth 1.7 compatibility report

Date: 2026-11-04. Branch: `fix/better-auth-1-7-compat`, based on `origin/main`.

## Result

SDK 0.4.0 cannot run with Better Auth 1.7.15 in a consumer: its imported
`genericOAuthClient` export no longer exists. This branch adapts the existing SDK
sign-in API to the social endpoint on 1.7, while retaining the OAuth2 endpoint on
1.2/1.6. A new SDK patch is necessary: **0.4.1, proposed and unreleased**. Version
metadata is bumped in the feature branch, matching the 0.3.2/0.4.0 commits. The
highest remote tag was checked: v0.4.0. No tags or releases were created.

The peer range remains `>=1.2.8`: the minimum passes the same runtime flow,
build and typecheck. This is compatibility evidence, not a recommendation to
deploy older vulnerable Better Auth releases.

## Package check and installation

- Package: official `better-auth/better-auth`, npm maintainer `bekacru`, published
  since 2024-04-22. It was already a dependency of this repository.
- `npm view better-auth time --json` selected **1.7.15**, published
  **2026-11-01T09:14:09.595Z**, over 3.5 days before installation. 1.7.16
  (2026-11-03T21:23:56.784Z) and 1.7.17 (2026-11-04T15:53:58.867Z) were too young.
  The short interval between those latest releases was an additional reason to
  reject them. The selected version is above the advisory's fixed 1.7.7 boundary.
- Checked the package metadata and unpacked distribution before installation.
  No install/prepare lifecycle hook exists in Better Auth 1.7.15 or 1.2.8.
  The SDK's own `prepare` is deliberately skipped and its build run explicitly.
- Inspected the entry module and telemetry implementation: environment-backed
  configuration is read by core; no unconditional network request was found at
  module import. Discovery runs at auth initialization on 1.7. Telemetry needs
  opt-in configuration/an endpoint; tests explicitly disable it. Auth requests in
  the integration fixture only reach localhost. This is a targeted package check,
  not an exhaustive audit of every transitive module.
- Main lockfile: **13 versions changed, zero new dependency paths, two removed**
  (127 to 125 entries). None of the changed entries declares an install script.
  All changed versions were checked against npm publication times before install;
  the permanent gate also passed all 125 locked entries. The isolated 1.2.8 tree
  was separately age-checked before installation, including its older WebAuthn tree.
- Conclusion: **install with `--ignore-scripts`**. No release-age override was used.
  npm 10's optional SvelteKit/Vite peer resolution failed with `ERESOLVE`; used
  `--legacy-peer-deps` to exclude those unused framework integrations. This does
  not relax the separate three-day release-age gate.

Commands used for the main dependency change:

```sh
npm install --package-lock-only --ignore-scripts --legacy-peer-deps --save-dev --save-exact better-auth@1.7.15
# Check changed versions against npm time before package execution.
node scripts/check-release-age.mjs
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run typecheck
npm test
```

## Verification

| Better Auth | Build | Typecheck | Full suite |
| --- | --- | --- | --- |
| 1.2.8 | pass | pass | 78/78 |
| 1.6.30 | pass | pass | 78/78 |
| 1.7.15 | pass | pass | 78/78 |

Executed on agent-worker, Node 22.23.4 / npm 10.9.9. Each legacy matrix entry
used a separate temporary directory; the working tree retained the 1.7.15 lock.
There is no lint command/config in the repository; `git diff --check` passed.
The expected provision-network-failure test prints its existing non-fatal warning.

`src/__tests__/compat.test.ts` uses the actual Better Auth client, SDK helper,
Generic OAuth plugin, memory adapter, callback handler and session API. Its local
OIDC fixture provides discovery, JWKS, signed ID tokens, token exchange and
UserInfo. Four scenarios cover normal/silent login and new/existing unverified
local users. They assert prompt, S256 PKCE, callback/token redirect consistency,
no resource parameter, app-specific session cookies, account linking without
duplicates, successful session lookup and collision-guard rejection during real
auth initialization. Profile/email are absent from ID tokens, exercising UserInfo.

Red/green evidence: before changing `src/client.ts`, both original integration
scenarios passed on 1.6.30 and failed on 1.7.15 with
`TypeError: genericOAuthClient is not a function`; build also failed with TS2305
for the removed export. They passed after the adapter. The existing provider-config
unit test was changed to observe the real factory arguments instead of a private
`.options` field absent in 1.2.8; actual runtime coverage is separate.

The release-age gate was also fault-tested by substituting registry metadata
with a publication time of "now": it exited 1 with
`Release must be at least 3 days old`. Real registry metadata passed.

`.github/workflows/compatibility.yml` runs the full build/typecheck/test matrix on
push and pull request. It resolves lockfiles without scripts, checks every locked
release age, and only then installs without scripts. **GitHub Actions results
could not be read on this worker: `gh run list` requires an unavailable GH_TOKEN.**
Local results above are verified; remote CI status remains unverified.

## OIDC contract and remaining consumer work

README documents old/new callback registration, resources, ID-token audience,
UserInfo and issuer handling. The SDK does not need a `resource` parameter for
this OIDC login. It does not implement protected-API access-token targeting.
Upstream restored the pre-1.7 account schema in 1.7.3, so direct 1.6 to 1.7.15
upgrades do not require issuer backfill. Databases that ran 1.7.0–1.7.2 need their
leftover issuer constraints reviewed. See the primary sources linked in README.

Fetched Plast ID's `fix/better-auth-1-7-ghsa-965c` branch: the requested
`docs/better-auth-1-7-upgrade.md` was absent at the time of this check. No database
or deployed consumer was queried. The fixture demonstrates the client contract;
it does not prove the real IdP's migrations, registrations or deployment are ready.
Plast ID, PlastSurgeon, JPBRS and SurgAI still need coordinated consumer checks;
SurgAI must synchronize `vendor/plast-id-client` after approval.

`npm audit` on the updated lock still reports **5 development-tool findings**
(1 moderate, 2 high, 2 critical): Vitest/@vitest/mocker, tinypool, Vite and
source-map-js. These packages already existed on the base and were not changed
by this branch. No Better Auth finding remains in that audit result. Tooling
remediation is outside this compatibility change. Fresh-context review is left
for the requested single review from Mads' PC; no PR, merge or deploy was performed.

## Suggested PR

## Review follow-up

The P1 finding about the adapter's untyped fetch response was confirmed. A new
cast-free consumer test failed typecheck with TS2339 on both `data.url` and
`data.redirect` before the fix. The adapter now declares the redirect response
shape explicitly. Build, typecheck and all 79 tests pass on Better Auth 1.7.15;
the targeted compatibility suite passes all five tests. The existing CI matrix
also typechecks this new test on 1.2.8 and 1.6.30; those versions were not rerun
locally for this follow-up. No lint script is configured. No review findings
were rejected or left unresolved. No dependencies were installed or changed.

## Suggested PR (updated verification)

Title: **Support Better Auth 1.7 while preserving legacy SSO login**

Description:

```markdown
Better Auth 1.7 removes genericOAuthClient and moves Generic OAuth login to the
social endpoints, so SDK 0.4.0 fails to load. Preserve the SDK signIn.oauth2 API
with a compatible adapter and pin development Better Auth to 1.7.15. Keep the
tested >=1.2.8 peer range and prepare the unreleased 0.4.1 patch.

Refs mahope/plast-id#88
Refs mahope/plast-id#89

Verified: build, typecheck and 78 tests on each of 1.2.8, 1.6.30 and 1.7.15.
Real-client OIDC tests cover interactive/silent login, PKCE, signed tokens,
UserInfo, existing-account linking, cookie isolation and session lookup. The test
failed on the original SDK with 1.7.15 and passed after the change. CI runs this
matrix with a three-day release-age gate and scripts disabled during install.

Open: remote Actions status could not be queried without GH_TOKEN; fresh-context
review, consumer callback registrations, provider migrations and SurgAI's vendor
sync remain. Five existing development-tool audit findings are documented.

Rollback: revert this PR's commits to restore the previous SDK and lockfile.
There are no database or production changes in this PR. Keep old callback URIs
registered during consumer rollout. A consumer runtime rollback to vulnerable
Better Auth 1.6 is not a security remediation for #88.
```
