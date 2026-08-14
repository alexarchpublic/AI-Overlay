/**
 * @file scripts/tool-loop-latency.mjs
 *
 * B4 latency gate (PRD_Optimizer_MCP_Integration §3.2/§7.3): run the demo
 * prompt's tool-loop shape N times against the REAL Gemini API and the REAL
 * production optimizer, and print the latency distribution. The evidence
 * belongs in CLAUDE_HANDOFF.md — pasted, not asserted-and-discarded.
 *
 * Usage (operator; the Gemini key never leaves the environment):
 *   GEMINI_API_KEY=... \
 *   OPTIMIZER_MCP_URL=https://optimize.archpublic.com/mcp \
 *   OPTIMIZER_TEAM_KEY=... node scripts/tool-loop-latency.mjs [runs=20]
 *
 * Mirrors geminiService's loop: call 1 with functionDeclarations (no JSON
 * mode), execute the requested read-only tools via MCP, final call in JSON
 * schema mode with summarized results. Gate: p95 ≤ 12 s.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.OPTIMIZER_MCP_URL;
const teamKey = process.env.OPTIMIZER_TEAM_KEY;
if (!apiKey || !mcpUrl || !teamKey) {
  console.error('Set GEMINI_API_KEY, OPTIMIZER_MCP_URL, OPTIMIZER_TEAM_KEY.');
  process.exit(2);
}
const RUNS = Number(process.argv[2] ?? 20);
const MODEL = 'gemini-3.1-flash-lite-preview';
const PROMPT = 'backtest NVDA on 1d with default settings and tell me if it beat buy-and-hold';
const GEMINI_TOOLS = new Set(['list_capabilities', 'backtest', 'compare_timeframes', 'detect_regimes']);

const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: { headers: { 'X-Arch-Team-Key': teamKey } },
});
const mcp = new Client({ name: 'tool-loop-latency', version: '1.0.0' });
await mcp.connect(transport);
const { tools } = await mcp.listTools();
const declarations = tools
  .filter((t) => GEMINI_TOOLS.has(t.name))
  .map((t) => ({
    name: t.name,
    description: t.description ?? t.name,
    parameters: { type: 'OBJECT', properties: { ticker: { type: 'STRING' }, timeframe: { type: 'STRING' } }, required: ['ticker'] },
  }));

const sdk = new GoogleGenerativeAI(apiKey);
const sys = 'You are a quantitative co-pilot for Arch Public Market Wave. Use the provided tools to compute real backtests; at most 2 tool rounds.';
const latencies = [];

for (let i = 0; i < RUNS; i += 1) {
  const t0 = Date.now();
  let toolText = '';
  let rounds = 0;
  const toolModel = sdk.getGenerativeModel({
    model: MODEL,
    systemInstruction: { parts: [{ text: sys }] },
    tools: [{ functionDeclarations: declarations }],
  });
  const contents = [{ role: 'user', parts: [{ text: PROMPT }] }];
  while (rounds < 2) {
    const res = await toolModel.generateContent({ contents });
    const calls = (res.response.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.functionCall)
      .filter(Boolean);
    if (calls.length === 0) break;
    rounds += 1;
    const parts = [];
    for (const call of calls) {
      const out = await mcp.callTool({ name: call.name, arguments: call.args ?? {} });
      const text = (out.content ?? []).find((p) => p.type === 'text')?.text ?? '';
      const trimmed = text.length > 7_000 ? `${text.slice(0, 7_000)}…` : text;
      toolText += `\n- ${call.name}: ${trimmed}`;
      parts.push({ functionResponse: { name: call.name, response: { result: trimmed } } });
    }
    contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    contents.push({ role: 'user', parts });
  }
  const finalModel = sdk.getGenerativeModel({
    model: MODEL,
    systemInstruction: { parts: [{ text: sys }] },
    generationConfig: { responseMimeType: 'application/json' },
  });
  await finalModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n[COMPUTED OPTIMIZER RESULTS]${toolText}\n\nAnswer as JSON {"analysis": string}.` }] }],
  });
  const ms = Date.now() - t0;
  latencies.push(ms);
  console.log(`run ${String(i + 1).padStart(2)}: ${ms} ms (${rounds} tool round${rounds === 1 ? '' : 's'})`);
}

latencies.sort((a, b) => a - b);
const pick = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
console.log(`\nruns=${RUNS} p50=${pick(50)}ms p95=${pick(95)}ms max=${latencies.at(-1)}ms`);
console.log(pick(95) <= 12_000 ? 'B4 LATENCY GATE PASSED (p95 ≤ 12 s)' : 'B4 LATENCY GATE FAILED (p95 > 12 s)');
await mcp.close();
