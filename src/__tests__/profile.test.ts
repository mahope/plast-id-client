import { describe, it, expect, vi } from "vitest";
import { PLAST_ID_PROFILE_CLAIMS, profileFromClaims, profileFromIdToken } from "../profile.js";
import { seedPlastIdProfile } from "../server.js";

/**
 * plast-id#122 — claims fra Plast ID's lokale OIDC-roundtrip (userinfo med
 * `openid profile email`), kopieret fra plast-id `docs/shared-profile.md`.
 */
const USERINFO = {
  sub: "lesyqYb0NMPcoswBKJQrWsMtdJzGTfXf",
  name: "Ada Lovelace",
  given_name: "Ada",
  family_name: "Lovelace",
  email: "ada@example.com",
  email_verified: true,
  locale: "da",
  updated_at: 1794869946,
  "https://plastid/claims/title": "Dr.",
  "https://plastid/claims/profession": "surgeon",
  "https://plastid/claims/specialty": "Hand surgery",
  "https://plastid/claims/institution": "Rigshospitalet",
  "https://plastid/claims/country": "DK",
  "https://plastid/claims/orcid": "0000-0002-1825-0097",
  "https://plastid/claims/hcp_verified": true,
  roles: [],
  account_acr: "urn:plastid:pwd",
};

function makeIdToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fake-signature`;
}

describe("profileFromClaims", () => {
  it("mapper Plast ID's claims til en profil", () => {
    expect(profileFromClaims(USERINFO)).toEqual({
      name: "Ada Lovelace",
      picture: null,
      locale: "da",
      title: "Dr.",
      profession: "surgeon",
      specialty: "Hand surgery",
      institution: "Rigshospitalet",
      country: "DK",
      orcid: "0000-0002-1825-0097",
      hcpVerified: true,
      updatedAt: new Date(1794869946 * 1000),
    });
  });

  it("giver null-felter for tomme Plast ID-felter, når profilen er udleveret", () => {
    const profile = profileFromClaims({ sub: "u1", name: "Ada", [PLAST_ID_PROFILE_CLAIMS.hcpVerified]: false });
    expect(profile).toMatchObject({ name: "Ada", title: null, orcid: null, country: null, hcpVerified: false, updatedAt: null });
  });

  it("returnerer null uden profile-scope (ingen hcp_verified), så appen beholder sin kopi", () => {
    expect(profileFromClaims({ sub: "u1", email: "a@example.com", roles: [] })).toBeNull();
    expect(profileFromClaims({ sub: "u1", name: "Ada", [PLAST_ID_PROFILE_CLAIMS.hcpVerified]: "true" })).toBeNull();
    expect(profileFromClaims(null)).toBeNull();
  });

  it("ignorerer en ukendt profession og forkerte typer", () => {
    const profile = profileFromClaims({
      ...USERINFO,
      "https://plastid/claims/profession": "wizard",
      "https://plastid/claims/title": 42,
      updated_at: "yesterday",
    });
    expect(profile).toMatchObject({ profession: null, title: null, updatedAt: null });
  });

  it("læser profilen fra et gemt ID-token", () => {
    expect(profileFromIdToken(makeIdToken(USERINFO))?.orcid).toBe("0000-0002-1825-0097");
    expect(profileFromIdToken("not-a-jwt")).toBeNull();
  });
});

describe("seedPlastIdProfile", () => {
  const env = { PLAST_SSO_ISSUER: "https://id.example.com/", PLAST_PROVISION_TOKEN: "tok" };

  it("POSTer sub og profil til /api/provision/profile med provision-tokenet", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ seeded: ["title"], kept: [], rejected: [], updatedAt: 1794869946 }), { status: 200 }),
    );
    const result = await seedPlastIdProfile("u1", { title: "Dr.", hcpVerified: true }, { env, fetchImpl });
    expect(result).toEqual({ ok: true, status: 200, seeded: ["title"], kept: [], rejected: [], updatedAt: 1794869946 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://id.example.com/api/provision/profile");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ sub: "u1", profile: { title: "Dr.", hcpVerified: true } });
  });

  it("er no-op uden token og kaster aldrig", async () => {
    const fetchImpl = vi.fn();
    expect(await seedPlastIdProfile("u1", {}, { env: { PLAST_SSO_ISSUER: "https://id.example.com" }, fetchImpl })).toEqual({ ok: false, status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw new Error("network down"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await seedPlastIdProfile("u1", {}, { env, fetchImpl: failing })).toEqual({ ok: false, status: 0 });
    warn.mockRestore();
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(await seedPlastIdProfile("u1", {}, { env, fetchImpl: notFound })).toEqual({ ok: false, status: 404 });
  });
});
