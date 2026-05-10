/**
 * @powforge/mcp-identity — MCP server module
 *
 * Exposes the PowForge Depth-of-Identity oracle as three MCP tools:
 *   - doi_score_lookup(pubkey, auth?)   → priced signed envelope
 *   - doi_sign_vouch(target, ...)        → unsigned kind:33335 event template
 *   - doi_score_verify(envelope)         → offline schnorr verification
 *
 * The server runs over the standard MCP stdio transport. Most callers reach
 * it via the npx-installed bin (see src/server.js) and the MCP config in
 * Claude Code / Cursor / similar.
 *
 * This module exports the tool implementations as plain functions so they
 * can be tested in isolation without spinning up a full stdio transport.
 */

'use strict';

const { lookupScore } = require('./lib/oracle.js');
const { verifyEnvelope, DEFAULT_ORACLE_PUBKEY } = require('./lib/verify.js');

/**
 * Tool: doi_score_lookup
 *
 * Input shape:
 *   { pubkey: string, auth?: { macaroon: string, preimage: string } }
 *
 * Output shape (paid):
 *   { paid: true, envelope: <full signed DoI score JSON> }
 *
 * Output shape (challenge):
 *   { paid: false, challenge: { macaroon, invoice, price_sats, scope, next_step } }
 */
async function doi_score_lookup(input, opts = {}) {
  if (!input || typeof input !== 'object') return { error: 'input_required' };
  const { pubkey, auth } = input;
  if (!pubkey || typeof pubkey !== 'string') {
    return { error: 'pubkey_required', hint: 'Pass a 64-hex pubkey or an npub1... bech32 string.' };
  }
  return lookupScore(pubkey, { auth, fetchImpl: opts.fetchImpl });
}

/**
 * Tool: doi_sign_vouch
 *
 * Returns an UNSIGNED kind:33335 vouch event template. The caller signs
 * externally (browser extension, hardware key, persona script). This keeps
 * the MCP server key-free.
 *
 * Input shape:
 *   {
 *     target: string,        // 64-hex pubkey of the subject being vouched
 *     depth: number,         // voucher's claimed DoI depth
 *     vouch_count: number,   // voucher's total outbound vouch count (for sqrt dilution)
 *     sats?: number,         // optional sats backing
 *     content?: string       // optional human-readable note
 *   }
 *
 * Output shape:
 *   {
 *     unsigned_event: { kind: 33335, created_at, content, tags: [...] },
 *     instructions: 'Sign with your nostr secret. Then publish to relays.'
 *   }
 */
function doi_sign_vouch(input) {
  if (!input || typeof input !== 'object') return { error: 'input_required' };
  const { target, depth, vouch_count, sats, content } = input;
  if (!target || typeof target !== 'string') {
    return { error: 'target_required', hint: '64-hex pubkey of the subject being vouched.' };
  }
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0) {
    return { error: 'depth_required', hint: 'Voucher depth (integer).' };
  }
  if (typeof vouch_count !== 'number' || !Number.isFinite(vouch_count) || vouch_count < 0) {
    return { error: 'vouch_count_required', hint: 'Voucher total outbound vouch count.' };
  }

  const tags = [
    ['p', target],
    ['depth', String(depth)],
    ['vouch_count', String(vouch_count)],
  ];
  if (typeof sats === 'number' && Number.isFinite(sats) && sats > 0) {
    tags.push(['sats', String(Math.floor(sats))]);
  }

  const unsigned_event = {
    kind: 33335,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: typeof content === 'string' ? content : '',
  };

  return {
    unsigned_event,
    instructions: 'Sign this event with your Nostr secret key (e.g. via NIP-07 extension or scripts/vouch-publish.js with --confirm), then publish to relays. The MCP server intentionally never holds keys.',
  };
}

/**
 * Tool: doi_score_verify
 *
 * Input shape:
 *   {
 *     envelope: object,         // the signed DoI score JSON returned by oracle
 *     oracle_pubkey?: string    // optional override (default = b4b12d...)
 *   }
 *
 * Output shape:
 *   { valid: boolean, oracle_pubkey: string, reason?: string }
 */
async function doi_score_verify(input) {
  if (!input || typeof input !== 'object') return { error: 'input_required' };
  const { envelope, oracle_pubkey } = input;
  if (!envelope || typeof envelope !== 'object') {
    return { error: 'envelope_required', hint: 'Pass the full signed JSON returned by a prior doi_score_lookup.' };
  }
  return verifyEnvelope(envelope, oracle_pubkey);
}

/**
 * Tool registry for the MCP server. Each entry is { name, description,
 * inputSchema, handler } so the stdio transport can advertise them via
 * tools/list and route tools/call.
 */
const TOOLS = [
  {
    name: 'doi_score_lookup',
    description: 'Fetch a Depth-of-Identity score for a Nostr pubkey from the PowForge oracle. Returns either an L402 challenge (macaroon + bolt11 invoice + price_sats) for the caller to pay, or a Schnorr-signed score envelope when paid auth is supplied. Pricing is 1-2 sats per call.',
    inputSchema: {
      type: 'object',
      properties: {
        pubkey: { type: 'string', description: '64-hex Nostr pubkey or npub1... bech32 string' },
        auth: {
          type: 'object',
          description: 'L402 paid auth. Omit on first call to receive the challenge.',
          properties: {
            macaroon: { type: 'string' },
            preimage: { type: 'string' },
          },
          required: ['macaroon', 'preimage'],
        },
      },
      required: ['pubkey'],
    },
    handler: doi_score_lookup,
  },
  {
    name: 'doi_sign_vouch',
    description: 'Build an UNSIGNED kind:33335 PowForge vouch event template. The MCP server intentionally never holds keys — the caller signs externally and publishes the signed event to relays.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '64-hex pubkey of the subject being vouched' },
        depth: { type: 'number', description: "Voucher's claimed DoI depth (integer)" },
        vouch_count: { type: 'number', description: "Voucher's total outbound vouch count (drives sqrt dilution)" },
        sats: { type: 'number', description: 'Optional sats backing' },
        content: { type: 'string', description: 'Optional human-readable note' },
      },
      required: ['target', 'depth', 'vouch_count'],
    },
    handler: doi_sign_vouch,
  },
  {
    name: 'doi_score_verify',
    description: 'Locally verify a Schnorr-signed DoI score envelope returned by the PowForge oracle. No network call. Default oracle pubkey is hardcoded; override via oracle_pubkey or the ORACLE_PUBKEY env var.',
    inputSchema: {
      type: 'object',
      properties: {
        envelope: { type: 'object', description: 'The full signed JSON from a prior doi_score_lookup' },
        oracle_pubkey: { type: 'string', description: 'Override oracle pubkey (64-hex). Default = b4b12d...' },
      },
      required: ['envelope'],
    },
    handler: doi_score_verify,
  },
];

module.exports = {
  TOOLS,
  doi_score_lookup,
  doi_sign_vouch,
  doi_score_verify,
  DEFAULT_ORACLE_PUBKEY,
};
