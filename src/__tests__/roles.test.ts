import { describe, it, expect, vi } from "vitest";
import {
  fetchCentralRolesClaim,
  createRolesTtlCache,
  createLiveRolesLookup,
  decodeIdTokenClaims,
  rolesFromIdToken,
  resolveEffectiveRoles,
  hasEffectiveRole,
  freshestIdToken,
  centralRolesForApp,
} from "../roles.js";

function makeIdToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}.fake-signature`;
}

describe("decodeIdTokenClaims", () => {
  it("decoder payload fra et velformet JWT", () => {
    const token = makeIdToken({ sub: "u1", roles: ["admin"] });
    expect(decodeIdTokenClaims(token)).toMatchObject({ sub: "u1", roles: ["admin"] });
  });

  it("returnerer null for null/undefined/tom", () => {
    expect(decodeIdTokenClaims(null)).toBeNull();
    expect(decodeIdTokenClaims(undefined)).toBeNull();
    expect(decodeIdTokenClaims("")).toBeNull();
  });

  it("returnerer null for token uden tre segmenter", () => {
    expect(decodeIdTokenClaims("abc.def")).toBeNull();
    expect(decodeIdTokenClaims("ikke-et-jwt")).toBeNull();
  });

  it("returnerer null for ikke-JSON payload (fail-safe)", () => {
    expect(decodeIdTokenClaims("aGVhZGVy.bm90LWpzb24.sig")).toBeNull();
  });

  it("returnerer null når payload er et array (ikke et claims-objekt)", () => {
    const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    expect(decodeIdTokenClaims(`${b64url({})}.${b64url([1, 2])}.sig`)).toBeNull();
  });
});

describe("rolesFromIdToken", () => {
  it("udtrækker roles-claimen", () => {
    expect(rolesFromIdToken(makeIdToken({ roles: ["admin", "editor"] }))).toEqual([
      "admin",
      "editor",
    ]);
  });

  it("tom liste når roles mangler eller ikke er et array", () => {
    expect(rolesFromIdToken(makeIdToken({}))).toEqual([]);
    expect(rolesFromIdToken(makeIdToken({ roles: "admin" }))).toEqual([]);
    expect(rolesFromIdToken(null)).toEqual([]);
  });

  it("filtrerer ikke-streng-elementer fra", () => {
    expect(rolesFromIdToken(makeIdToken({ roles: ["admin", 42, null, "editor"] }))).toEqual([
      "admin",
      "editor",
    ]);
  });
});

describe("resolveEffectiveRoles", () => {
  it("union af lokal (streng) og central", () => {
    expect(resolveEffectiveRoles("user", ["admin"])).toEqual(["user", "admin"]);
  });

  it("union af lokal (liste) og central, deduperet", () => {
    expect(resolveEffectiveRoles(["admin", "user"], ["admin", "editor"])).toEqual([
      "admin",
      "user",
      "editor",
    ]);
  });

  it("tåler null/undefined/tomme på begge sider", () => {
    expect(resolveEffectiveRoles(null, null)).toEqual([]);
    expect(resolveEffectiveRoles(undefined, [])).toEqual([]);
    expect(resolveEffectiveRoles("", ["editor"])).toEqual(["editor"]);
  });

  it("trimmer whitespace og dropper tomme strenge", () => {
    expect(resolveEffectiveRoles([" admin ", ""], ["  "])).toEqual(["admin"]);
  });
});

const ENV = {
  PLAST_SSO_ISSUER: "https://id.mahoje.dk",
  PLAST_SSO_CLIENT_ID: "plastsurgeon",
  PLAST_SSO_CLIENT_SECRET: "s",
  PLAST_PROVISION_TOKEN: "ptok",
};

function jsonRes(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchCentralRolesClaim", () => {
  it("henter claim-entries med provision-token mod /api/roles", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { roles: ["admin", "editor:plastsurgeon"] }));
    const roles = await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl });
    expect(roles).toEqual(["admin", "editor:plastsurgeon"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://id.mahoje.dk/api/roles?email=a%40b.com",
      expect.objectContaining({
        headers: { Authorization: "Bearer ptok" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("404 er autoritativt: tom liste (bruger uden central identitet)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(404, { error: "not_found" }));
    expect(await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl })).toEqual([]);
  });

  it("null ved manglende konfiguration (caller falder tilbage)", async () => {
    expect(await fetchCentralRolesClaim("a@b.com", { env: {}, fetchImpl: vi.fn() })).toBeNull();
    expect(await fetchCentralRolesClaim("", { env: ENV, fetchImpl: vi.fn() })).toBeNull();
  });

  it("null ved serverfejl, malformet JSON og netværksfejl (fail-safe)", async () => {
    expect(await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl: vi.fn(async () => jsonRes(500)) })).toBeNull();
    expect(await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl: vi.fn(async () => jsonRes(200, { roles: "admin" })) })).toBeNull();
    expect(await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl: vi.fn(async () => { throw new Error("net"); }) })).toBeNull();
  });

  it("filtrerer ikke-streng-entries fra svaret", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { roles: ["admin", 42, null] }));
    expect(await fetchCentralRolesClaim("a@b.com", { env: ENV, fetchImpl })).toEqual(["admin"]);
  });
});

describe("createLiveRolesLookup", () => {
  it("cacher autoritative svar i positiv TTL (ét fetch-kald)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { roles: ["admin"] }));
    const lookup = createLiveRolesLookup({ env: ENV, fetchImpl });
    expect(await lookup("a@b.com")).toEqual(["admin"]);
    expect(await lookup("a@b.com")).toEqual(["admin"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("negative-cacher fejl kort, så nedetid ikke rammer hvert request", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonRes(500));
    const lookup = createLiveRolesLookup({ env: ENV, fetchImpl, negativeTtlMs: 30_000 });
    expect(await lookup("a@b.com")).toBeNull();
    expect(await lookup("a@b.com")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // negativ cache-hit
    vi.advanceTimersByTime(31_000);
    await lookup("a@b.com");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // genprøvet efter negativ TTL
    vi.useRealTimers();
  });

  it("sender timeout-signal til fetch (hængende IdP blokerer ikke)", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonRes(200, { roles: [] });
    });
    await createLiveRolesLookup({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })("a@b.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createRolesTtlCache", () => {
  it("husker inden for TTL og glemmer efter", () => {
    vi.useFakeTimers();
    const cache = createRolesTtlCache(1000);
    cache.set("a@b.com", ["admin"]);
    expect(cache.get("a@b.com")).toEqual(["admin"]);
    vi.advanceTimersByTime(1500);
    expect(cache.get("a@b.com")).toBeUndefined();
    vi.useRealTimers();
  });

  it("miss for ukendt nøgle", () => {
    expect(createRolesTtlCache(1000).get("x")).toBeUndefined();
  });
});

describe("centralRolesForApp", () => {
  it("medtager globale roller og denne apps scoped roller (scope strippet)", () => {
    expect(
      centralRolesForApp(["admin", "editor:jpbrs", "author:plastsurgeon"], "jpbrs"),
    ).toEqual(["admin", "editor"]);
  });

  it("ignorerer andre apps' scoped roller", () => {
    expect(centralRolesForApp(["reviewer:surgai"], "jpbrs")).toEqual([]);
  });

  it("dedupérer når global og scoped giver samme rolle", () => {
    expect(centralRolesForApp(["editor", "editor:jpbrs"], "jpbrs")).toEqual(["editor"]);
  });

  it("fail-safe ved malformede entries og null", () => {
    expect(centralRolesForApp(null, "jpbrs")).toEqual([]);
    expect(centralRolesForApp([":jpbrs", "", "admin"], "jpbrs")).toEqual(["admin"]);
  });
});

describe("freshestIdToken", () => {
  it("vælger den senest opdaterede Plast ID-række på tværs af normal + silent", () => {
    expect(
      freshestIdToken([
        { providerId: "plast-id", idToken: "gammel", updatedAt: new Date("2026-07-01") },
        { providerId: "plast-id-silent", idToken: "frisk", updatedAt: new Date("2026-07-10") },
      ]),
    ).toBe("frisk");
  });

  it("ignorerer andre providers og rækker uden idToken", () => {
    expect(
      freshestIdToken([
        { providerId: "google", idToken: "google-token", updatedAt: new Date("2026-07-10") },
        { providerId: "plast-id", idToken: null, updatedAt: new Date("2026-07-10") },
        { providerId: "plast-id", idToken: "eneste", updatedAt: new Date("2026-06-01") },
      ]),
    ).toBe("eneste");
  });

  it("tåler updatedAt som string og manglende updatedAt", () => {
    expect(
      freshestIdToken([
        { providerId: "plast-id", idToken: "uden-dato" },
        { providerId: "plast-id-silent", idToken: "med-dato", updatedAt: "2026-07-10T00:00:00Z" },
      ]),
    ).toBe("med-dato");
  });

  it("null når ingen kandidater", () => {
    expect(freshestIdToken([])).toBeNull();
    expect(freshestIdToken([{ providerId: "github", idToken: "x" }])).toBeNull();
  });
});

describe("hasEffectiveRole", () => {
  it("finder rollen lokalt eller centralt", () => {
    expect(hasEffectiveRole("admin", "admin", [])).toBe(true);
    expect(hasEffectiveRole("admin", "user", ["admin"])).toBe(true);
    expect(hasEffectiveRole("admin", "user", ["editor"])).toBe(false);
  });

  it("central rolle kan aldrig fjerne lokal adgang (additiv model)", () => {
    // Lokal admin forbliver admin uanset hvad central siger.
    expect(hasEffectiveRole("admin", "admin", ["user"])).toBe(true);
  });
});
