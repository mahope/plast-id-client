import { describe, it, expect } from "vitest";
import {
  plastIdConfig,
  isPlastIdConfigured,
  plastIdCookiePrefix,
  sanitizeCookiePrefix,
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

describe("sanitizeCookiePrefix", () => {
  it("lowercaser og erstatter ugyldige tegn med bindestreg", () => {
    expect(sanitizeCookiePrefix("PlastSurgeon")).toBe("plastsurgeon");
    expect(sanitizeCookiePrefix("jpbrs.staging")).toBe("jpbrs-staging");
    expect(sanitizeCookiePrefix("plast_id client!!")).toBe("plast-id-client");
  });
  it("kollapser gentagne bindestreger og trimmer kant-bindestreger", () => {
    expect(sanitizeCookiePrefix("--a...b--")).toBe("a-b");
  });
  it("falder tilbage til en sikker værdi hvis intet gyldigt tegn tilbage", () => {
    expect(sanitizeCookiePrefix("...")).toBe("plast-id-app");
  });
});

describe("plastIdCookiePrefix", () => {
  it("afleder prefix af PLAST_SSO_CLIENT_ID", () => {
    expect(plastIdCookiePrefix(full)).toBe("plastsurgeon");
  });
  it("er undefined uden en konfigureret client id", () => {
    expect(plastIdCookiePrefix({})).toBeUndefined();
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
