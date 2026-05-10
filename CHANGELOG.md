# Changelog

## 0.7.0 — 2026-04-29

First release. MCP server exposing the PowForge Depth-of-Identity oracle to MCP-compatible agents.

### Added

- `doi_score_lookup` tool — priced lookup of Schnorr-signed DoI scores via L402. Challenge-passthrough flow keeps the MCP server stateless and key-free.
- `doi_sign_vouch` tool — builds an UNSIGNED `kind:33335` vouch event template. Caller signs externally and publishes.
- `doi_score_verify` tool — offline schnorr verification of signed envelopes against the oracle pubkey. No network call after first install.
- Stdio MCP transport via `@modelcontextprotocol/sdk`.
- `npx @powforge/mcp-identity --install` prints a ready-to-paste MCP config block.
- Default oracle pubkey hardcoded (`b4b12dfbc3dfdfa803bb72e344e761dc78db4ec2058c8db3f1c3ac63f9e42b44`); `ORACLE_PUBKEY` and `ORACLE_URL` env vars override.
- Test suite: 14 unit tests covering all three tools, L402 challenge parsing, canonical JSON serialization, and signature tamper detection.

### Out of scope for v0.7.0

- In-process LNBits payment (caller currently handles payment out-of-band).
- NIP-89 `kind:31990` handler advertisement on Nostr (planned for v0.7.1).
- Cross-tool chaining (e.g. composing `doi_score_lookup` + `doi_sign_vouch` in one call).
