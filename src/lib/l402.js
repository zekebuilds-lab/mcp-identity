/**
 * L402 challenge parser.
 *
 * The MCP server is challenge-passthrough: it does NOT pay invoices itself.
 * It surfaces the 402 response (macaroon + bolt11 invoice + price) to the
 * MCP caller. The caller pays the invoice out-of-band, takes the preimage,
 * and re-invokes the MCP tool with `auth: { macaroon, preimage }` in the
 * tool input. This keeps the server stateless and key-free.
 *
 * Why not auto-pay? Three reasons:
 *   1. We don't want to hold LNBits keys in an MCP server process.
 *   2. Different callers want different wallets (LND, Phoenix, LNBits, hosted).
 *   3. The 402 surface is the natural place for the caller's policy
 *      (rate limits, max-price, identity-aware budget).
 */

'use strict';

/**
 * Parse a WWW-Authenticate header carrying an L402 challenge.
 *
 * Header shape: `L402 macaroon="<base64>", invoice="<bolt11>"`
 *
 * @param {string} header  the WWW-Authenticate value
 * @returns {{macaroon: string, invoice: string} | null}
 */
function parseChallenge(header) {
  if (!header || typeof header !== 'string') return null;
  if (!/^L402\s/i.test(header.trim())) return null;
  const macMatch = header.match(/macaroon="([^"]+)"/);
  const invMatch = header.match(/invoice="([^"]+)"/);
  if (!macMatch || !invMatch) return null;
  return { macaroon: macMatch[1], invoice: invMatch[1] };
}

/**
 * Build an L402 Authorization header value from a macaroon + preimage.
 * The shape is `L402 <macaroon>:<preimage>` per the L402 spec (preimage
 * is the SHA-256 preimage of the invoice's payment_hash, returned by the
 * Lightning node when the invoice is settled).
 */
function buildAuthorization(macaroon, preimage) {
  if (!macaroon || !preimage) {
    throw new Error('buildAuthorization: macaroon and preimage are required');
  }
  return `L402 ${macaroon}:${preimage}`;
}

/**
 * Shape a 402 fetch response into a callable challenge object that the
 * MCP tool returns to its caller. The caller pays the invoice and re-calls
 * with auth populated.
 */
function challengeFromResponse(status, headers, body) {
  if (status !== 402) return null;
  const wwwAuth = headers && (headers['www-authenticate'] || headers['WWW-Authenticate']);
  const parsed = parseChallenge(wwwAuth);
  const priceHeader = headers && (headers['x-l402-price-sats'] || headers['X-L402-Price-Sats']);
  const priceFromHeader = priceHeader ? parseInt(priceHeader, 10) : null;
  const priceFromBody = body && typeof body.price_sats === 'number' ? body.price_sats : null;
  return {
    payment_required: true,
    macaroon: parsed?.macaroon || (body && body.macaroon) || null,
    invoice: parsed?.invoice || (body && body.invoice) || null,
    payment_hash: (body && body.payment_hash) || null,
    price_sats: priceFromHeader ?? priceFromBody ?? null,
    scope: (body && body.scope) || null,
    next_step: 'Pay the bolt11 invoice. Re-invoke this tool with auth: { macaroon, preimage } to receive the signed score.',
  };
}

module.exports = { parseChallenge, buildAuthorization, challengeFromResponse };
