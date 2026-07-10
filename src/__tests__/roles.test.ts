import { describe, it, expect } from "vitest";
import {
  decodeIdTokenClaims,
  rolesFromIdToken,
  resolveEffectiveRoles,
  hasEffectiveRole,
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
