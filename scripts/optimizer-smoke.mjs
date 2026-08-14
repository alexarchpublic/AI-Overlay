/**
 * @file scripts/optimizer-smoke.mjs
 *
 * Cross-system smoke for the hosted optimizer MCP endpoint
 * (PRD_Optimizer_MCP_Integration §7.2): connect → list tools →
 * list_capabilities → one backtest round-trip → assert shapes. Used for the
 * B2 gate and re-runnable by the operator any time.
 *
 * Usage:
 *   OPTIMIZER_MCP_URL=https://optimize.archpublic.com/mcp \
 *   OPTIMIZER_TEAM_KEY=... node scripts/optimizer-smoke.mjs
 *
 * The key comes from the environment on purpose — never hard-code it and
 * never commit it (D-M4).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.OPTIMIZER_MCP_URL;
const teamKey = process.env.OPTIMIZER_TEAM_KEY;
if (!url || !teamKey) {
  console.error('Set OPTIMIZER_MCP_URL and OPTIMIZER_TEAM_KEY.');
  process.exit(2);
}

const EXPECTED_TOOL_COUNT = 11;

function firstText(result) {
  const part = (result.content ?? []).find((p) => p.type === 'text');
  return part ? part.text : '';
}

const t0 = Date.now();
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { 'X-Arch-Team-Key': teamKey } },
});
const client = new Client({ name: 'optimizer-smoke', version: '1.0.0' });
await client.connect(transport);
console.log(`connected in ${Date.now() - t0} ms`);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length} — ${tools.map((t) => t.name).join(', ')}`);
if (tools.length !== EXPECTED_TOOL_COUNT) {
  console.error(`FAIL: expected ${EXPECTED_TOOL_COUNT} tools`);
  process.exit(1);
}

const caps = await client.callTool({ name: 'list_capabilities', arguments: {} });
const capsJson = JSON.parse(firstText(caps));
console.log(
  `capabilities: ${capsJson.tickers.length} tickers, ` +
  `${capsJson.timeframes.length} timeframes, ${capsJson.objectives.length} objectives`);

const ticker = capsJson.tickers.includes('NVDA') ? 'NVDA' : capsJson.tickers[0];
const bt0 = Date.now();
const bt = await client.callTool({
  name: 'backtest',
  arguments: { ticker, timeframe: '1d' },
});
const btMs = Date.now() - bt0;
const btJson = JSON.parse(firstText(bt));
const sharpe = btJson?.metrics?.sharpe_ratio;
console.log(
  `backtest ${ticker} 1d: ${btMs} ms, bars=${btJson.bars}, ` +
  `sharpe=${sharpe}, params_used keys=${Object.keys(btJson.params_used ?? {}).length}`);

if (typeof sharpe !== 'number' || !btJson.params_used) {
  console.error('FAIL: backtest shape unexpected');
  process.exit(1);
}
if (btMs >= 2_000) {
  console.warn(`WARN: backtest took ${btMs} ms (gate expects < 2 s warm)`);
}

await client.close();
console.log('SMOKE PASSED');
