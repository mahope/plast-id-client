# Changelog

## 0.4.1 (proposed, unreleased)

- Preserve the SDK's OAuth2 sign-in API on Better Auth 1.7 by routing through the
  core social endpoint when the legacy Generic OAuth client plugin is absent.
- Preserve typed OAuth2 redirect responses (`url` and `redirect`) for consumers.
- Pin the development dependency to Better Auth 1.7.15, the newest 1.7 release at
  least three days old on 2026-11-04. Keep the tested `>=1.2.8` peer range.
- Add real client/server OIDC flow coverage and CI against 1.2.8, 1.6.30 and 1.7.15,
  including silent login, PKCE, signed tokens, UserInfo, existing-account linking,
  session cookies and the cookie-collision guard. Enforce release age before install.
- Document callback registration, provider resources and the version-specific
  issuer migration. Consumers on Better Auth 1.7 need this patch; 0.4.0 cannot
  load its removed `genericOAuthClient` export. SurgAI must sync its vendored SDK.

Version metadata follows the existing feature-commit convention. No release or
tag is created by this change. Refs mahope/plast-id#88, mahope/plast-id#89.
