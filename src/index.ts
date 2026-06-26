/**
 * @mahope/plast-id-client — delt Plast ID SSO-klient for Mahope-produktsuiten.
 *
 * Foretrukne entry-points er sub-paths (holder server-kode ude af klient-bundlen):
 *   import { plastIdServerPlugins, provisionToPlastId } from "@mahope/plast-id-client/server";
 *   import { plastIdClientPlugin, signInWithPlastId } from "@mahope/plast-id-client/client";
 *   import { buildSilentAuthUrl, shouldAttemptSilentAuth } from "@mahope/plast-id-client/silent";
 *
 * Denne rod re-eksporterer kun det rene, framework-agnostiske config-lag.
 */
export * from "./config.js";
