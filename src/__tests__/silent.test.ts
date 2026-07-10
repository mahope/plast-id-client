import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildSilentAuthUrl,
  shouldAttemptSilentAuth,
  isLoginRequiredError,
  hasSilentGuard,
  silentGuardCookie,
  attemptSilentSSO,
  SILENT_GUARD_COOKIE,
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

describe("hasSilentGuard / silentGuardCookie", () => {
  it("genkender guard-cookien i en cookie-streng", () => {
    expect(hasSilentGuard(`${SILENT_GUARD_COOKIE}=1`)).toBe(true);
    expect(hasSilentGuard(`foo=bar; ${SILENT_GUARD_COOKIE}=1; baz=qux`)).toBe(true);
    expect(hasSilentGuard("foo=bar")).toBe(false);
    expect(hasSilentGuard("")).toBe(false);
  });

  it("matcher ikke cookies der blot har guarden som præfiks i navnet", () => {
    expect(hasSilentGuard(`${SILENT_GUARD_COOKIE}_other=1`)).toBe(false);
  });

  it("bygger cookie-værdi med Path, Max-Age og SameSite", () => {
    expect(silentGuardCookie(300)).toBe(`${SILENT_GUARD_COOKIE}=1; Path=/; Max-Age=300; SameSite=Lax`);
    expect(silentGuardCookie()).toContain("Max-Age=600");
  });
});

describe("attemptSilentSSO", () => {
  const realDocument = globalThis.document;
  const realWindow = globalThis.window;

  afterEach(() => {
    globalThis.document = realDocument;
    globalThis.window = realWindow;
  });

  function stubBrowser(opts: { cookie?: string; search?: string } = {}) {
    let cookie = opts.cookie ?? "";
    globalThis.document = {
      get cookie() { return cookie; },
      set cookie(v: string) { cookie = `${cookie ? cookie + "; " : ""}${v.split(";")[0]}`; },
    } as unknown as Document;
    globalThis.window = {
      location: { search: opts.search ?? "", href: "https://app.example/dashboard" },
    } as unknown as Window & typeof globalThis;
    return { getCookie: () => cookie };
  }

  function stubClient() {
    const oauth2 = vi.fn().mockResolvedValue(undefined);
    return { client: { signIn: { oauth2 } }, oauth2 };
  }

  it("no-op uden browser-miljø (SSR-safe)", async () => {
    // @ts-expect-error simulér SSR
    delete globalThis.document;
    // @ts-expect-error simulér SSR
    delete globalThis.window;
    const { client, oauth2 } = stubClient();
    expect(await attemptSilentSSO(client, { hasLocalSession: false })).toBe(false);
    expect(oauth2).not.toHaveBeenCalled();
  });

  it("starter silent-forsøg, sætter guard og bruger plast-id-silent provider", async () => {
    const { getCookie } = stubBrowser();
    const { client, oauth2 } = stubClient();
    expect(await attemptSilentSSO(client, { hasLocalSession: false })).toBe(true);
    expect(getCookie()).toContain(`${SILENT_GUARD_COOKIE}=1`);
    expect(oauth2).toHaveBeenCalledWith({
      providerId: "plast-id-silent",
      callbackURL: "https://app.example/dashboard",
    });
  });

  it("respekterer eksplicit returnTo", async () => {
    stubBrowser();
    const { client, oauth2 } = stubClient();
    await attemptSilentSSO(client, { hasLocalSession: false, returnTo: "/efter-login" });
    expect(oauth2).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: "/efter-login" }),
    );
  });

  it("no-op med lokal session", async () => {
    stubBrowser();
    const { client, oauth2 } = stubClient();
    expect(await attemptSilentSSO(client, { hasLocalSession: true })).toBe(false);
    expect(oauth2).not.toHaveBeenCalled();
  });

  it("no-op når guard-cookien allerede er sat (one-shot)", async () => {
    stubBrowser({ cookie: `${SILENT_GUARD_COOKIE}=1` });
    const { client, oauth2 } = stubClient();
    expect(await attemptSilentSSO(client, { hasLocalSession: false })).toBe(false);
    expect(oauth2).not.toHaveBeenCalled();
  });

  it("no-op når URL'en netop bærer login_required (ingen ring-bounce)", async () => {
    stubBrowser({ search: "?error=login_required" });
    const { client, oauth2 } = stubClient();
    expect(await attemptSilentSSO(client, { hasLocalSession: false })).toBe(false);
    expect(oauth2).not.toHaveBeenCalled();
  });

  it("fail-safe: kaster aldrig når sign-in-kaldet fejler (IdP nede)", async () => {
    stubBrowser();
    const oauth2 = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await attemptSilentSSO({ signIn: { oauth2 } }, { hasLocalSession: false });
    expect(result).toBe(false);
  });
});
