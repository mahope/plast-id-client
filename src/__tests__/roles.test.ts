import { describe, it, expect } from "vitest";
import {
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
