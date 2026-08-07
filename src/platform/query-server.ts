/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/**
 * query-server.ts
 * ─────────────────────────────────────────────────────────────
 * Step 7b — Knowledge Base UI Server
 * Personal AI-Augmented Testing Framework
 *
 * Starts a local web server serving the NL Query chat UI.
 * Opens automatically in your browser.
 *
 * Run:  npx tsx src/query-server.ts
 *       npm run query:ui
 * ─────────────────────────────────────────────────────────────
 */

import * as http   from 'http';
import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';
import { RunRepository } from '../core/storage/repositories/RunRepository'
import { aiCall }        from '../core/ai/AiClient'
import { getAppName, getBaseUrl } from '../core/config/appConfig'

dotenv.config();

const PORT     = 4242;
const LOCAL_ONLY_HOST = '127.0.0.1';
const INDEX    = 'reports/knowledge-index.json';
const API_KEY  = process.env.ANTHROPIC_API_KEY ?? '';

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (
        parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '[::1]'
        || parsed.hostname === '::1'
      );
  } catch {
    return false;
  }
}

function rejectUnsafeBrowserOrigin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (isAllowedLocalOrigin(req.headers.origin)) return false;
  res.writeHead(403, { 'Content-Type': 'application/json', 'Vary': 'Origin' });
  res.end(JSON.stringify({
    error: 'FORGE query UI accepts browser requests only from a local loopback origin.',
    code: 'LOCAL_ORIGIN_REQUIRED',
  }));
  return true;
}

// ── Build knowledge index if missing ─────────────────────────

async function ensureIndex(): Promise<boolean> {
  const runRepo = new RunRepository()
  const dbRuns  = await runRepo.findByApp(getAppName(), 1)
  if (!dbRuns.length) return false;
  if (!fs.existsSync(INDEX)) {
    console.log('  Building knowledge index first...');
    try {
      const { execSync } = require('child_process');
      execSync('npx tsx src/knowledge-query.ts --rebuild', { stdio: 'ignore' });
    } catch {}
  }
  return fs.existsSync(INDEX);
}

// ── HTML UI ───────────────────────────────────────────────────

function buildUI(index: Record<string, any>): string {
  const stats = index.overallStats ?? {};
  const runs  = index.totalRuns ?? 0;
  const pats  = (index.topFailures ?? []).length;
  const rate  = index.runTimeline?.slice(-1)?.[0]?.passRate ?? 'N/A';
  const streak = stats.currentStreak ?? 0;
  const dateFirst = index.dateRange?.first
    ? new Date(index.dateRange.first).toLocaleDateString() : '';
  const dateLast  = index.dateRange?.last
    ? new Date(index.dateRange.last).toLocaleDateString() : '';

  const suggestions = [
    'Which tests failed the most?',
    'What should I fix first?',
    'Give me a health summary of the framework',
    'What is our webkit failure rate?',
    'How much faster are we running now vs when we started?',
    'Which tests are flaky on webkit but not chromium?',
    'Show me all Bug verdicts',
    'Which suite has the most failures?',
    'Are there any tests that have never passed?',
    'What was the worst run and why?',
  ];

  const sugHTML = suggestions.map(s =>
    `<button class="sug" onclick="ask('${s.replace(/'/g,"\\'")}')">` +
    `<i class="ti ti-message" aria-hidden="true"></i>${s}</button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Knowledge Base</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;color:#1a1a1a}
body{display:flex;flex-direction:column;align-items:center;padding:2rem 1rem}
.wrap{width:100%;max-width:760px;display:flex;flex-direction:column;gap:0}
h1{font-size:20px;font-weight:500;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:1.5rem}
.stats-row{display:flex;gap:12px;margin-bottom:1rem;flex-wrap:wrap}
.stat{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:10px 16px;font-size:12px;color:#888}
.stat span{display:block;font-size:20px;font-weight:500;color:#1a1a1a}
.chatbox{background:#fff;border:1px solid #e8e8e8;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.messages{padding:1.25rem;display:flex;flex-direction:column;gap:14px;min-height:360px;max-height:480px;overflow-y:auto}
.msg{display:flex;flex-direction:column;gap:4px}
.msg.user{align-items:flex-end}
.msg.ai{align-items:flex-start}
.msg-label{font-size:11px;color:#aaa;padding:0 4px}
.bubble{padding:10px 16px;border-radius:18px;font-size:14px;line-height:1.6;max-width:85%}
.msg.user .bubble{background:#1a56db;color:#fff;border-radius:18px 18px 4px 18px}
.msg.ai .bubble{background:#f4f5f7;color:#1a1a1a;border-radius:18px 18px 18px 4px}
.msg.ai .bubble code{background:#e8eaed;padding:1px 6px;border-radius:4px;font-size:12px;font-family:monospace}
.typing{display:flex;align-items:center;gap:4px;padding:10px 16px}
.typing span{width:6px;height:6px;background:#aaa;border-radius:50%;animation:bounce 1s infinite}
.typing span:nth-child(2){animation-delay:.15s}
.typing span:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
.suggestions{padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #f0f0f0}
.sug{font-size:12px;padding:5px 12px;border-radius:20px;border:1px solid #e0e0e0;background:#fff;color:#555;cursor:pointer;display:flex;align-items:center;gap:5px;transition:all .15s}
.sug:hover{background:#f0f4ff;border-color:#b3c6ff;color:#1a56db}
.sug i{font-size:13px}
.input-row{padding:14px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px}
.input-row input{flex:1;border:1px solid #e0e0e0;border-radius:24px;padding:10px 18px;font-size:14px;outline:none;background:#f8f9fa}
.input-row input:focus{border-color:#1a56db;background:#fff}
.input-row button{background:#1a56db;color:#fff;border:none;border-radius:24px;padding:10px 22px;font-size:14px;cursor:pointer;font-weight:500}
.input-row button:hover{background:#1648c8}
.input-row button:disabled{background:#c0c0c0;cursor:not-allowed}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#aaa;font-size:14px;gap:8px;padding:2rem}
.empty-state i{font-size:32px;color:#d0d0d0}
footer{font-size:12px;color:#bbb;margin-top:1.5rem;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <h1>Test knowledge base</h1>
  <p class="sub">Ask anything about your test suite in plain English &nbsp;·&nbsp; ${dateFirst} → ${dateLast}</p>

  <div class="stats-row">
    <div class="stat"><span>${runs}</span>runs indexed</div>
    <div class="stat"><span>${pats}</span>failure patterns</div>
    <div class="stat"><span>${rate}</span>current pass rate</div>
    <div class="stat"><span>${streak}</span>clean streak</div>
  </div>

  <div class="chatbox">
    <div class="messages" id="msgs">
      <div class="empty-state">
        <i class="ti ti-robot" aria-hidden="true"></i>
        <span>Ask a question or pick a suggestion below</span>
      </div>
    </div>
    <div class="suggestions" id="sugs">${sugHTML}</div>
    <div class="input-row">
      <input id="inp" type="text" placeholder="Ask about your test suite..."
        onkeydown="if(event.key==='Enter')send()" autocomplete="off" />
      <button id="btn" onclick="send()">Ask</button>
    </div>
  </div>
  <footer>FORGE &nbsp;·&nbsp; Step 7 Knowledge Base &nbsp;·&nbsp; rkasthuri/forge-framework</footer>
</div>

<script>
const INDEX = ${JSON.stringify(index)};
const SYSTEM = \`You are a QA intelligence assistant for a Playwright E2E testing framework running against ${getAppName()} (${getBaseUrl()}).
Answer in plain, conversational English — no markdown headers. Use specific test IDs, numbers, and dates from the data.
Keep answers to 2-5 sentences unless listing items. If a question can't be answered from the data, say so clearly.\`;

let history = [];
let busy = false;

function addMsg(role, text) {
  const msgs = document.getElementById('msgs');
  const empty = msgs.querySelector('.empty-state');
  if(empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const label = role === 'user' ? 'You' : 'AI';
  div.innerHTML = '<div class="msg-label">'+label+'</div><div class="bubble">'+text+'</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function addTyping() {
  const msgs = document.getElementById('msgs');
  const div = document.createElement('div');
  div.id = 'typing';
  div.className = 'msg ai';
  div.innerHTML = '<div class="msg-label">AI</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typing');
  if(t) t.remove();
}

async function ask(question) {
  if(busy) return;
  document.getElementById('inp').value = question;
  send();
}

async function send() {
  const inp = document.getElementById('inp');
  const btn = document.getElementById('btn');
  const q = inp.value.trim();
  if(!q || busy) return;

  busy = true;
  inp.value = '';
  btn.disabled = true;

  addMsg('user', q);
  history.push({ role: 'user', content: 'Knowledge base:\\n' + JSON.stringify(INDEX, null, 1).slice(0, 8000) + '\\n\\nQuestion: ' + q });

  addTyping();

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, system: SYSTEM })
    });
    const data = await res.json();
    const answer = data.answer ?? 'Sorry, I could not answer that.';

    removeTyping();
    addMsg('ai', answer.replace(/\`([^\`]+)\`/g, '<code>$1</code>'));
    history.push({ role: 'assistant', content: answer });

    if(history.length > 12) history = history.slice(-12);

  } catch(e) {
    removeTyping();
    addMsg('ai', 'Error connecting to the API. Make sure the server is running with your ANTHROPIC_API_KEY set.');
  }

  busy = false;
  btn.disabled = false;
  inp.focus();
}
window.ask = ask;
window.send = send;
</script>
</body>
</html>`;
}

// ── HTTP server ───────────────────────────────────────────────

async function handleQuery(body: string, res: http.ServerResponse) {
  try {
    const { messages, system } = JSON.parse(body);
    const aiResp = await aiCall({
      operation: 'knowledge-qa',
      appName:   getAppName(),
      system,
      messages,
      maxTokens: 512,
    })

    const answer = aiResp.content

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answer }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answer: `Server error: ${err}` }));
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env\n'); process.exit(1);
  }

  const indexReady = await ensureIndex();
  if (!indexReady) {
    console.error('❌ No run history found. Run npm run test:all first.\n'); process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX, 'utf-8'));
  const ui    = buildUI(index);

  const server = http.createServer((req, res) => {
    if (rejectUnsafeBrowserOrigin(req, res)) return;
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(ui);
    } else if (req.method === 'POST' && req.url === '/api/query') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end',  () => handleQuery(body, res));
    } else {
      res.writeHead(404); res.end();
    }
  });

  server.listen(PORT, LOCAL_ONLY_HOST, () => {
    console.log(`\n🧠 Knowledge Base UI — running at http://localhost:${PORT}\n`);
    console.log(`  ${index.totalRuns} runs indexed · ${(index.topFailures ?? []).length} failure patterns`);
    console.log('\n  Press Ctrl+C to stop.\n');

    const { execSync } = require('child_process');
    try { execSync(`start http://localhost:${PORT}`); } catch {}
  });
}

main().catch(err => { console.error(err); process.exit(1); });
