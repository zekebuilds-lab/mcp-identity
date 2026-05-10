/**
 * Oracle client wrapper around https://identity.powforge.dev/oracle/doi-score.
 *
 * Returns either:
 *   { paid: false, challenge: { macaroon, invoice, price_sats, ... } }  — 402
 *   { paid: true,  envelope: { ...signed-doi-score-json } }              — 200
 *   { error: string, status: number }                                    — anything else
 *
 * Uses Node 18+ global fetch.
 */

'use strict';

const { challengeFromResponse, buildAuthorization } = require('./l402.js');

const DEFAULT_ORACLE_URL = 'https://identity.powforge.dev';

function resolveOracleUrl() {
  return (process.env.ORACLE_URL || DEFAULT_ORACLE_URL).replace(/\/$/, '');
}

/**
 * Fetch a DoI score for a pubkey or npub. If `auth` is provided
 * ({macaroon, preimage}) the call is made with the L402 Authorization
 * header. Otherwise the 402 challenge is returned to the caller.
 *
 * @param {string} pubkeyOrNpub  64-hex pubkey or npub1... bech32
 * @param {object} [opts]
 * @param {{macaroon: string, preimage: string}} [opts.auth]
 * @param {object} [opts.fetchImpl]  test seam; default = global fetch
 * @returns {Promise<object>}
 */
async function lookupScore(pubkeyOrNpub, opts = {}) {
  if (!pubkeyOrNpub || typeof pubkeyOrNpub !== 'string') {
    return { error: 'pubkey_required', status: 400 };
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { error: 'fetch_unavailable', status: 0 };
  }

  const url = `${resolveOracleUrl()}/oracle/doi-score/${encodeURIComponent(pubkeyOrNpub)}`;
  const headers = { Accept: 'application/json' };
  if (opts.auth && opts.auth.macaroon && opts.auth.preimage) {
    headers.Authorization = buildAuthorization(opts.auth.macaroon, opts.auth.preimage);
  }

  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers });
  } catch (e) {
    return { error: 'network_error', status: 0, detail: e.message };
  }

  // Build a plain header bag (fetch's Headers object isn't directly indexable)
  const hdrs = {};
  if (res.headers && typeof res.headers.forEach === 'function') {
    res.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
  } else if (res.headers && typeof res.headers === 'object') {
    for (const [k, v] of Object.entries(res.headers)) hdrs[k.toLowerCase()] = String(v);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }

  if (res.status === 402) {
    const challenge = challengeFromResponse(402, hdrs, body);
    return { paid: false, challenge };
  }
  if (res.status === 200) {
    return { paid: true, envelope: body };
  }
  return { error: 'oracle_error', status: res.status, body };
}

module.exports = { lookupScore, DEFAULT_ORACLE_URL, resolveOracleUrl };
