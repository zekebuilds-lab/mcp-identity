#!/usr/bin/env node
/**
 * @powforge/mcp-identity — MCP stdio server entrypoint.
 *
 * This is the npx-installable binary. Starts an MCP server over stdio,
 * advertises the three identity tools, and routes tools/call invocations
 * to the implementations in ./index.js.
 *
 * Designed to be referenced from a Claude Code / Cursor / Continue MCP config:
 *
 *     {
 *       "mcpServers": {
 *         "powforge-identity": {
 *           "command": "npx",
 *           "args": ["-y", "@powforge/mcp-identity"]
 *         }
 *       }
 *     }
 *
 * Optional environment variables:
 *   ORACLE_URL     override the oracle base URL (default: https://identity.powforge.dev)
 *   ORACLE_PUBKEY  override the oracle's schnorr pubkey for verification
 */

'use strict';

const { TOOLS } = require('./index.js');

// --install: ergonomic helper that prints a ready-to-paste MCP config block
// matching Claude Code's expected shape. We don't write to the user's config
// for them — that's their decision, and config paths vary across editors.
if (process.argv.includes('--install') || process.argv.includes('-i')) {
  const block = {
    mcpServers: {
      'powforge-identity': {
        command: 'npx',
        args: ['-y', '@powforge/mcp-identity'],
      },
    },
  };
  // eslint-disable-next-line no-console
  console.log('Add this block to your MCP config (e.g. ~/.config/Claude/claude_desktop_config.json):\n');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(block, null, 2));
  // eslint-disable-next-line no-console
  console.log('\nThen restart your MCP client. The three tools (doi_score_lookup, doi_sign_vouch, doi_score_verify) will appear automatically.');
  process.exit(0);
}

async function main() {
  // Load the MCP SDK lazily so --install works even if @modelcontextprotocol/sdk
  // failed to install (e.g. in CI environments without npm access).
  let Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema;
  try {
    ({ Server } = require('@modelcontextprotocol/sdk/server/index.js'));
    ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
    ({ ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js'));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('@powforge/mcp-identity: @modelcontextprotocol/sdk not installed.');
    // eslint-disable-next-line no-console
    console.error('Run: npm install @modelcontextprotocol/sdk');
    process.exit(1);
  }

  const server = new Server(
    { name: '@powforge/mcp-identity', version: '0.7.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find(t => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool', tool: req.params.name }) }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(req.params.arguments || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'tool_threw', message: e.message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('@powforge/mcp-identity fatal:', e.message);
  process.exit(1);
});
