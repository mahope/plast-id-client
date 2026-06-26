import { describe, it, expect } from "vitest";
import {
  buildSilentAuthUrl,
  shouldAttemptSilentAuth,
  isLoginRequiredError,
} from "../silent.js";

describe("buildSilentAuthUrl", () => {
  it("danner authorize-URL med prompt=none og alle params", () => {
    const url = buildSilentAuthUrl({
      issuer: "https://id.mahoje.dk",
      clientId: "plastsurgeon",
      redirectUri: "https://plastsurgeon.com/api/auth/oauth2/callback/plast-id",
      state: "csrf123",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://id.mahoje.dk/api/auth/oauth2/authorize");
    expect(u.searchParams.get("prompt")).toBe("none");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile email");
    expect(u.searchParams.get("client_id")).toBe("plastsurgeon");
    expect(u.searchParams.get("redirect_uri")).toBe("https://plastsurgeon.com/api/auth/oauth2/callback/plast-id");
    expect(u.searchParams.get("state")).toBe("csrf123");
  });
});

describe("shouldAttemptSilentAuth", () => {
  it("forsøger kun uden lokal session, ikke allerede forsøgt, ikke login_required-callback", () => {
    expect(shouldAttemptSilentAuth({ hasLocalSession: false, alreadyAttempted: false, isLoginRequiredCallback: false })).toBe(true);
  });
  it("springer over når der allerede er en lokal session", () => {
    expect(shouldAttemptSilentAuth({ hasLocalSession: true, alreadyAttempted: false, isLoginRequiredCallback: false })).toBe(false);
  });
  it("springer over når allerede forsøgt (loop-guard)", () => {
    expect(shouldAttemptSilentAuth({ hasLocalSession: false, alreadyAttempted: true, isLoginRequiredCallback: false })).toBe(false);
  });
  it("springer over når vi netop fik login_required (ingen ring-bounce)", () => {
    expect(shouldAttemptSilentAuth({ hasLocalSession: false, alreadyAttempted: false, isLoginRequiredCallback: true })).toBe(false);
  });
});

describe("isLoginRequiredError", () => {
  it("genkender login_required som 'ikke logget ind', ikke en hård fejl", () => {
    expect(isLoginRequiredError(new URLSearchParams("error=login_required&state=x"))).toBe(true);
    expect(isLoginRequiredError(new URLSearchParams("code=abc&state=x"))).toBe(false);
    expect(isLoginRequiredError(new URLSearchParams("error=server_error"))).toBe(false);
  });
});
