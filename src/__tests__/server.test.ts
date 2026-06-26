import { describe, it, expect, vi } from "vitest";
import {
  plastIdServerPlugins,
  plastIdAccountLinking,
  getPlastIdRoles,
  provisionToPlastId,
  auditIngest,
  PLAST_ID_PROVIDER_ID,
} from "../server.js";

const configured = {
  PLAST_SSO_ISSUER: "https://id.mahoje.dk",
  PLAST_SSO_CLIENT_ID: "plastsurgeon",
  PLAST_SSO_CLIENT_SECRET: "secret",
  PLAST_PROVISION_TOKEN: "ptok",
  PLAST_AUDIT_TOKEN: "atok",
};

describe("plastIdServerPlugins", () => {
  it("returnerer tom liste når SSO ikke er konfigureret", () => {
    expect(plastIdServerPlugins({})).toEqual([]);
  });
  it("returnerer ét plugin når konfigureret", () => {
    expect(plastIdServerPlugins(configured)).toHaveLength(1);
  });
});

describe("plastIdAccountLinking", () => {
  it("gør plast-id til trusted provider og forbyder forskellige emails", () => {
    expect(plastIdAccountLinking.trustedProviders).toContain(PLAST_ID_PROVIDER_ID);
    expect(plastIdAccountLinking.allowDifferentEmails).toBe(false);
    expect(plastIdAccountLinking.enabled).toBe(true);
  });
});

describe("getPlastIdRoles", () => {
  it("udtrækker string-roller fra .roles", () => {
    expect(getPlastIdRoles({ roles: ["admin", "staff"] })).toEqual(["admin", "staff"]);
  });
  it("er tolerant: tom liste når roles mangler eller ikke er et array", () => {
    expect(getPlastIdRoles({})).toEqual([]);
    expect(getPlastIdRoles(null)).toEqual([]);
    expect(getPlastIdRoles({ roles: "admin" })).toEqual([]);
    expect(getPlastIdRoles({ roles: [1, "ok", null] })).toEqual(["ok"]);
  });
});

describe("provisionToPlastId", () => {
  it("no-op (status 0) når issuer/token mangler", async () => {
    const out = await provisionToPlastId(
      { email: "a@b.com", name: "A", emailVerified: false },
      { env: {} },
    );
    expect(out).toEqual({ ok: false, status: 0 });
  });

  it("POSTer med bearer-token og returnerer id/created ved succes", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: "prov_1", created: true }),
    })) as unknown as typeof fetch;
    const out = await provisionToPlastId(
      { email: "a@b.com", name: "A B", emailVerified: true },
      { env: configured, fetchImpl },
    );
    expect(out).toEqual({ ok: true, status: 201, id: "prov_1", created: true });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://id.mahoje.dk/api/provision");
    expect(call[1].headers.Authorization).toBe("Bearer ptok");
    expect(JSON.parse(call[1].body)).toEqual({ email: "a@b.com", name: "A B", emailVerified: true });
  });

  it("fail-safe: http-fejl giver ok:false uden at kaste", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const out = await provisionToPlastId({ email: "a@b.com", name: "A", emailVerified: false }, { env: configured, fetchImpl });
    expect(out).toEqual({ ok: false, status: 500 });
  });

  it("fail-safe: netværksfejl giver status 0 uden at kaste", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const out = await provisionToPlastId({ email: "a@b.com", name: "A", emailVerified: false }, { env: configured, fetchImpl });
    expect(out).toEqual({ ok: false, status: 0 });
  });
});

describe("auditIngest", () => {
  it("no-op når token mangler", async () => {
    expect(await auditIngest({ app: "plastsurgeon" }, { env: {} })).toEqual({ ok: false, status: 0 });
  });
  it("POSTer event med bearer-token", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const out = await auditIngest({ app: "plastsurgeon", action: "login" }, { env: configured, fetchImpl });
    expect(out).toEqual({ ok: true, status: 202 });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://id.mahoje.dk/api/audit/ingest");
    expect(call[1].headers.Authorization).toBe("Bearer atok");
  });
});
