import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/client";
import { plastIdClientPlugin, signInWithPlastId } from "../client.js";
import { plastIdServerPlugins, plastIdAccountLinking } from "../server.js";
import { plastIdCookiePrefix } from "../config.js";

const servers: ReturnType<typeof createServer>[] = [];
it("preserves the typed OAuth2 redirect response without a cast", async () => {
  const client = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [plastIdClientPlugin()],
    fetchOptions: {
      customFetchImpl: async () => Response.json({
        url: "http://localhost:3000/authorize",
        redirect: false,
      }),
    },
  });
  const result = await client.signIn.oauth2({ providerId: "plast-id", disableRedirect: true });
  expect(result.error).toBeNull();
  if (!result.data) throw new Error("Missing sign-in response");
  const url: string = result.data.url;
  const redirect: boolean = result.data.redirect;
  expect(url).toBe("http://localhost:3000/authorize");
  expect(redirect).toBe(false);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

it.each(["plast-id", "plast-id-silent"].flatMap((provider) => [
  [provider, false] as const,
  [provider, true] as const,
]))("completes %s (existing local account: %s) through the real client, callback and session API", async (providerId, existing) => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let nonce: string | null = null;
  let tokenBody = new URLSearchParams();
  let issuer = "";
  let userInfoRequests = 0;
  const fixture = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("openid-configuration")) {
      res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ["RS256"] }));
    } else if (req.url === "/jwks") {
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" }] }));
    } else if (req.url === "/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      tokenBody = new URLSearchParams(body);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const payload = `${encode({ alg: "RS256", kid: "fixture" })}.${encode({ iss: issuer, aud: "compat-app", sub: "fixture-user", iat: now, exp: now + 300, ...(nonce ? { nonce } : {}) })}`;
      res.end(JSON.stringify({ access_token: "fixture-access", token_type: "Bearer", expires_in: 300, id_token: `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}` }));
    } else if (req.url === "/userinfo") {
      userInfoRequests++;
      res.end(JSON.stringify({ sub: "fixture-user", id: "fixture-user", email: "fixture@example.test", email_verified: true, name: "Fixture" }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  servers.push(fixture);
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const env = { PLAST_SSO_ISSUER: issuer, PLAST_SSO_CLIENT_ID: "compat-app", PLAST_SSO_CLIENT_SECRET: "fixture-secret" };
  const advanced = { cookiePrefix: plastIdCookiePrefix(env), crossSubDomainCookies: { enabled: true, domain: "localhost" } };
  const db = { user: existing ? [{ id: "existing-user", email: "fixture@example.test", name: "Fixture", emailVerified: false, createdAt: new Date(), updatedAt: new Date() }] : [], session: [], account: [], verification: [] };
  const auth = betterAuth({ baseURL: "http://localhost:3000", secret: "fixture-secret-at-least-thirty-two-characters", database: memoryAdapter(db), account: { accountLinking: plastIdAccountLinking }, advanced, plugins: plastIdServerPlugins(env), telemetry: { enabled: false } });
  let cookies = "";
  const capture = (response: Response) => {
    const values = response.headers.getSetCookie().map((c) => c.split(";")[0]);
    if (values.length) cookies = values.join("; ");
  };
  const client = createAuthClient({ baseURL: "http://localhost:3000", plugins: [plastIdClientPlugin()], fetchOptions: { customFetchImpl: async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost:3000");
    headers.set("cookie", cookies);
    const response = await auth.handler(new Request(url, { ...init, headers }));
    capture(response);
    return response;
  } } });
  const result = providerId === "plast-id"
    ? await signInWithPlastId(client, { callbackURL: "/dashboard" })
    : await client.signIn.oauth2({ providerId, callbackURL: "/dashboard" });
  const login = result as { data: { url: string } | null; error: unknown };
  expect(login.error).toBeNull();
  const authorize = new URL(login.data!.url);
  expect(authorize.origin).toBe(issuer);
  expect(authorize.searchParams.get("client_id")).toBe("compat-app");
  expect(authorize.searchParams.get("prompt")).toBe(providerId.endsWith("silent") ? "none" : null);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["openid", "profile", "email"]));
  expect(authorize.searchParams.has("resource")).toBe(false);
  nonce = authorize.searchParams.get("nonce");
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  callback.searchParams.set("code", "fixture-code");
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  const response = await auth.handler(new Request(callback, { headers: { cookie: cookies } }));
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location")!, "http://localhost:3000").pathname).toBe("/dashboard");
  capture(response);
  expect(cookies).toContain("compat-app.session_token=");
  expect(cookies).not.toContain("better-auth.session_token=");
  expect(tokenBody.get("code_verifier")).toBeTruthy();
  expect(tokenBody.get("redirect_uri")).toBe(authorize.searchParams.get("redirect_uri"));
  const session = await client.getSession();
  expect(session.error).toBeNull();
  expect(session.data?.user.email).toBe("fixture@example.test");
  expect(session.data?.session.userId).toBe(session.data?.user.id);
  if (existing) expect(session.data?.user.id).toBe("existing-user");
  expect(db.user).toHaveLength(1);
  expect(db.account).toHaveLength(1);
  expect(userInfoRequests).toBeGreaterThan(0);

  const unsafe = betterAuth({ baseURL: "http://localhost:3000", secret: "fixture-secret-at-least-thirty-two-characters", database: memoryAdapter({}), advanced: { ...advanced, cookiePrefix: "better-auth" }, plugins: plastIdServerPlugins(env), telemetry: { enabled: false } });
  await expect(unsafe.$context).rejects.toThrow(/cookiePrefix/);
});
