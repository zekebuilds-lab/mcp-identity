# @powforge/mcp-identity

> MCP server that scores any Nostr pubkey's depth-of-identity before your handler runs. Chaintip-anchored Schnorr cert, L402 priced, drop-in for AI agents that need Sybil resistance on top of paid APIs.

**npm:** `npm i @powforge/mcp-identity`

**Homepage:** https://powforge.dev/explorer

**Whitepaper:** https://powforge.dev/whitepaper

## What It Does

Three MCP tools that wrap the PowForge Depth-of-Identity Oracle:

- **`doi_score_lookup`** — given a Nostr pubkey (hex or npub), returns multi-dimensional identity score (network, longevity, kinetic-filter cost). L402-priced via the upstream oracle.
- **`doi_sign_vouch`** — builds an unsigned Nostr event for vouching depth-of-identity for another pubkey. Caller signs; oracle counts toward score on observation.
- **`doi_score_verify`** — offline Schnorr verification of a signed DoI cert returned from the oracle. No network.

## Why Identity-Anchored Pricing

Most paid-API services charge per-request flat. That fails on agent-to-agent surfaces where:

1. New agents look identical to scrapers — no signal on intent or risk.
2. Long-tail abusers extract value cheaper than they impose cost.
3. Whitelist gating doesn't scale to open agent ecosystems.

DoI gives your server a quantitative number for "how much would it cost to fake this caller's identity at this depth" — anchored to a specific Bitcoin chaintip cert that's non-repudiable. Use it as a multiplier on your L402 macaroon price, a rate-limit input, or a routing key.

## Quick Start

```bash
npm i @powforge/mcp-identity
```

Add to your MCP config (Claude Desktop, Cursor, etc):

```json
{
  "mcpServers": {
    "powforge-identity": {
      "command": "npx",
      "args": ["-y", "@powforge/mcp-identity"]
    }
  }
}
```

Restart the client. Three new tools appear under `powforge-identity`.

## Why Chaintip-Anchored

The score includes a Schnorr signature over `(score, dimensions, score_chaintip_height, score_chaintip_blockhash)`. That binds the claim to Bitcoin's kinetic filter — recomputable PageRank scores can be silently rewritten, but a chaintip-anchored cert is a fixed claim against a known time. Verification is offline.

The oracle's falsifiable claim window is documented in the whitepaper.

## L402 Pricing

The MCP server transparently handles the L402 macaroon dance with `oracle.powforge.dev`. First call returns a 402 with a Lightning invoice; the wrapper pays from a wallet you configure (env: `LNBITS_INVOICE_KEY`) and retries. No keys, no accounts.

## Status

- v0.7.0 published to npm 2026-04-28.
- Three tools exposed.
- Cert format documented in the whitepaper.
- Oracle availability monitored at https://powforge.dev/oracle/freshness.

## License

MIT.

## Source

Source lives in a private development repo. Issues, questions, and bug reports welcome here.
