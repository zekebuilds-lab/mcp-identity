/**
 * Local verification of an oracle-signed DoI score.
 *
 * Recomputes the canonical message the oracle signs and verifies the schnorr
 * signature using @noble/secp256k1. No network call required after the oracle
 * pubkey is known. The default oracle pubkey is hardcoded; callers can
 * override via the `oracle_pubkey` argument or the `ORACLE_PUBKEY` env var.
 *
 * Canonical message format (must match the oracle's signing routine in
 * scripts/identity-score-server.js): a sorted-key JSON serialization of the
 * envelope minus the `signature` field. The exact field set depends on the
 * envelope version, so we strip `signature` and serialize the rest with
 * stable key ordering.
 */

'use strict';

const secp = require('@noble/secp256k1');
const { sha256: nobleSha256 } = require('@noble/hashes/sha2.js');
const { hmac } = require('@noble/hashes/hmac.js');

// @noble/secp256k1 v3 requires the caller to wire in a hash implementation.
// Without this, schnorr.sign / schnorr.verify throw 'hashes.sha256 not set'.
// We wire it once at module load. Idempotent — re-assigning the same fn is fine.
secp.hashes.sha256 = nobleSha256;
secp.hashes.hmacSha256 = (key, msg) => hmac(nobleSha256, key, msg);

// b4b12... is the published oracle pubkey advertised at /oracle/info
// (verified 2026-04-29T02:26Z).
const DEFAULT_ORACLE_PUBKEY = 'b4b12dfbc3dfdfa803bb72e344e761dc78db4ec2058c8db3f1c3ac63f9e42b44';

function resolveOraclePubkey(override) {
  if (override) return String(override).toLowerCase();
  if (process.env.ORACLE_PUBKEY) return String(process.env.ORACLE_PUBKEY).toLowerCase();
  return DEFAULT_ORACLE_PUBKEY;
}

/**
 * Stable JSON stringify with sorted object keys at every nesting level.
 * Required because schnorr signatures are over a canonical byte sequence,
 * so two implementations must agree on key order.
 */
function canonicalJSONStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSONStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSONStringify(value[k])).join(',') + '}';
}

function hexToBytes(hex) {
  if (typeof hex !== 'string') return null;
  const clean = hex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

async function sha256(data) {
  // Node 18+ has webcrypto on globalThis.crypto.subtle
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

/**
 * Verify a signed oracle envelope.
 *
 * @param {object} envelope          the full signed JSON returned by /oracle/doi-score
 * @param {string} [oraclePubkey]    override oracle pubkey (64-hex)
 * @returns {Promise<{valid: boolean, oracle_pubkey: string, reason?: string}>}
 */
async function verifyEnvelope(envelope, oraclePubkey) {
  const oracle = resolveOraclePubkey(oraclePubkey);
  const result = { valid: false, oracle_pubkey: oracle };
  if (!envelope || typeof envelope !== 'object') {
    result.reason = 'envelope_not_object';
    return result;
  }
  if (typeof envelope.signature !== 'string' || envelope.signature.length === 0) {
    result.reason = 'missing_signature';
    return result;
  }
  // Defensive: signed_by must match the oracle pubkey we're verifying against.
  // If the envelope claims a different signer, reject — the caller is asking
  // us to verify against `oracle`, so a mismatched signed_by is a red flag.
  if (envelope.signed_by && String(envelope.signed_by).toLowerCase() !== oracle) {
    result.reason = 'signed_by_mismatch';
    return result;
  }

  const { signature, ...rest } = envelope;
  const message = canonicalJSONStringify(rest);
  const messageBytes = new TextEncoder().encode(message);
  const messageHash = await sha256(messageBytes);

  const sigBytes = hexToBytes(signature);
  const pubBytes = hexToBytes(oracle);
  if (!sigBytes || sigBytes.length !== 64) {
    result.reason = 'malformed_signature';
    return result;
  }
  if (!pubBytes || pubBytes.length !== 32) {
    result.reason = 'malformed_pubkey';
    return result;
  }

  let ok = false;
  try {
    ok = await secp.schnorr.verify(sigBytes, messageHash, pubBytes);
  } catch (e) {
    result.reason = `verify_threw: ${e.message}`;
    return result;
  }
  result.valid = !!ok;
  if (!ok) result.reason = 'signature_invalid';
  return result;
}

module.exports = {
  verifyEnvelope,
  canonicalJSONStringify,
  resolveOraclePubkey,
  DEFAULT_ORACLE_PUBKEY,
};
