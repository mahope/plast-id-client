import { describe, it, expect } from "vitest";
import {
  plastIdConfig,
  isPlastIdConfigured,
  discoveryUrl,
  authorizeUrl,
  auditIngestUrl,
  provisionUrl,
  trimSlash,
} from "../config.js";

const full = {
  PLAST_SSO_ISSUER: "https://id.mahoje.dk/",
  PLAST_SSO_CLIENT_ID: "plastsurgeon",
  PLAST_SSO_CLIENT_SECRET: "secret",
  PLAST_AUDIT_TOKEN: "atok",
  PLAST_PROVISION_TOKEN: "ptok",
};

describe("plastIdConfig", () => {
  it("læser felter og trimmer trailing slash på issuer", () => {
    const c = plastIdConfig(full);
    expect(c.issuer).toBe("https://id.mahoje.dk");
    expect(c.clientId).toBe("plastsurgeon");
    expect(c.provisionToken).toBe("ptok");
  });
});

describe("isPlastIdConfigured", () => {
  it("kræver issuer + clientId + clientSecret", () => {
    expect(isPlastIdConfigured(full)).toBe(true);
    expect(isPlastIdConfigured({ PLAST_SSO_ISSUER: "https://x" })).toBe(false);
    expect(isPlastIdConfigured({})).toBe(false);
  });
});

describe("url-byggere", () => {
  it("danner korrekte endpoints uden dobbelt-slash", () => {
    expect(discoveryUrl("https://id.mahoje.dk/")).toBe(
      "https://id.mahoje.dk/api/auth/.well-known/openid-configuration",
    );
    expect(authorizeUrl("https://id.mahoje.dk")).toBe("https://id.mahoje.dk/api/auth/oauth2/authorize");
    expect(auditIngestUrl("https://id.mahoje.dk")).toBe("https://id.mahoje.dk/api/audit/ingest");
    expect(provisionUrl("https://id.mahoje.dk")).toBe("https://id.mahoje.dk/api/provision");
  });
  it("trimSlash fjerner kun trailing slashes", () => {
    expect(trimSlash("https://x/")).toBe("https://x");
    expect(trimSlash("https://x")).toBe("https://x");
  });
});
