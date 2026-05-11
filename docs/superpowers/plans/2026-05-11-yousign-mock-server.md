# Yousign Mock Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file Express server that mimics the Yousign API v3 locally so d24-backend can run its full signing flow without hitting the real Yousign API.

**Architecture:** One `server.js` file with in-memory Maps for state. On `activate`, a timer fires and POSTs a webhook back to d24-backend. An HTML dashboard at `/dashboard` shows all SRs with manual complete/decline buttons.

**Tech Stack:** Node.js, Express 4, multer (multipart), axios (outgoing webhook), uuid, dotenv

---

> **Note:** `package.json` and `server.js` may already exist as drafts from a previous session — overwrite them cleanly per Task 1 and Task 2.

---

## File Map

| File | Role |
|---|---|
| `package.json` | Dependencies + npm scripts |
| `.env.example` | Config template (committed) |
| `.env` | Local config (gitignored) |
| `.gitignore` | Ignore node_modules + .env |
| `server.js` | Entire mock server — built incrementally across tasks |
| `README.md` | Start guide + d24-backend wiring |

---

## Task 1: Project Setup

**Files:**
- Overwrite: `package.json`
- Create: `.env.example`
- Create: `.env`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "d24-yousign-mock",
  "version": "1.0.0",
  "description": "Mock Yousign API v3 for local testing",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.0"
  }
}
```

- [ ] **Step 2: Write `.env.example`**

```env
PORT=4099
WEBHOOK_TARGET=http://localhost:5019/signing/webhook/yousign
AUTO_COMPLETE_DELAY_MS=5000
```

- [ ] **Step 3: Write `.env`** (same content as .env.example to start)

```env
PORT=4099
WEBHOOK_TARGET=http://localhost:5019/signing/webhook/yousign
AUTO_COMPLETE_DELAY_MS=5000
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 5: Install dependencies**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock && npm install
```

Expected: `node_modules/` created, no errors, no audit warnings that block install.

- [ ] **Step 6: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add package.json package-lock.json .env.example .gitignore
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "chore: project setup with deps"
```

---

## Task 2: Server Bootstrap + Health Endpoint

**Files:**
- Create/Overwrite: `server.js`

- [ ] **Step 1: Write the full server bootstrap**

Create `/Users/denizcaliskan/dcal/d24-yousign-mock/server.js` with this exact content:

```js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

const PORT = process.env.PORT || 4099;
const WEBHOOK_TARGET = process.env.WEBHOOK_TARGET || 'http://localhost:5019/signing/webhook/yousign';
const AUTO_COMPLETE_DELAY_MS = parseInt(process.env.AUTO_COMPLETE_DELAY_MS || '5000', 10);

// ── In-memory store ───────────────────────────────────────────────────────────
const signatureRequests = new Map();
const documents = new Map();
const signers = new Map();
const contacts = new Map([
  ['contact-doctor-1', {
    id: 'contact-doctor-1',
    email: 'doctor@test.de',
    first_name: 'Max',
    last_name: 'Mustermann',
  }],
]);

// Minimal valid PDF (~200 bytes) — returned for all document downloads
const FAKE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
  '0000000058 00000 n\n0000000115 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
);

function log(msg, data) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`, data !== undefined ? JSON.stringify(data) : '');
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  ok: true,
  signatureRequests: signatureRequests.size,
  webhookTarget: WEBHOOK_TARGET,
  autoCompleteDelayMs: AUTO_COMPLETE_DELAY_MS,
}));

app.listen(PORT, () => {
  console.log(`\nYousign Mock → http://localhost:${PORT}`);
  console.log(`  WEBHOOK_TARGET      = ${WEBHOOK_TARGET}`);
  console.log(`  AUTO_COMPLETE_DELAY = ${AUTO_COMPLETE_DELAY_MS}ms\n`);
});
```

- [ ] **Step 2: Verify server starts and health responds**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1
curl -s http://localhost:4099/health
kill %1
```

Expected output:
```json
{"ok":true,"signatureRequests":0,"webhookTarget":"http://localhost:5019/signing/webhook/yousign","autoCompleteDelayMs":5000}
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: bootstrap express server with in-memory store"
```

---

## Task 3: Signature Request, Signer + Contact Routes

These are called by d24-backend to set up a signing session.

**Files:**
- Modify: `server.js` — insert routes between the `FAKE_PDF` constant and `app.get('/health', ...)`

- [ ] **Step 1: Add all routes**

Insert the following block in `server.js` after the `FAKE_PDF` constant and before `app.get('/health', ...)`:

```js
// ── Signature Requests ────────────────────────────────────────────────────────
app.post('/signature_requests', (req, res) => {
  const sr = {
    id: `sr-${uuidv4()}`,
    name: req.body.name || 'Mock SR',
    external_id: req.body.external_id || null,
    delivery_mode: req.body.delivery_mode || 'none',
    ordered_signers: req.body.ordered_signers ?? false,
    status: 'draft',
    created_at: new Date().toISOString(),
    documentIds: [],
    signerIds: [],
  };
  signatureRequests.set(sr.id, sr);
  log('[SR] Created', { id: sr.id, name: sr.name });
  const { documentIds, signerIds, ...resp } = sr;
  res.status(201).json(resp);
});

app.get('/signature_requests/:srId', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'Not found', status: 404 });
  const { documentIds, signerIds, ...resp } = sr;
  res.json(resp);
});

// ── Signers ───────────────────────────────────────────────────────────────────
app.post('/signature_requests/:srId/signers', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });

  const signer = {
    id: `signer-${uuidv4()}`,
    contact_id: req.body.contact_id,
    contact: contacts.get(req.body.contact_id) || { id: req.body.contact_id, email: 'mock@test.de' },
    signature_level: req.body.signature_level || 'electronic_signature',
    signature_authentication_mode: req.body.signature_authentication_mode || 'otp_sms',
    status: 'pending',
  };
  signers.set(signer.id, signer);
  sr.signerIds.push(signer.id);
  log('[SIGNER] Added', { srId: req.params.srId, signerId: signer.id });
  res.status(201).json(signer);
});

app.get('/signature_requests/:srId/signers', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });
  res.json(sr.signerIds.map(id => signers.get(id)));
});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.get('/contacts/:contactId', (req, res) => {
  const contact = contacts.get(req.params.contactId) || {
    id: req.params.contactId,
    email: 'mock@test.de',
    first_name: 'Mock',
    last_name: 'User',
  };
  res.json(contact);
});
```

- [ ] **Step 2: Verify SR creation**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1

curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock-key" \
  -d '{"name":"Test SR","delivery_mode":"none"}'

kill %1
```

Expected: JSON with `"id": "sr-..."` and `"status": "draft"`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add signature request, signer and contact routes"
```

---

## Task 4: Document Routes

d24-backend uploads the prescription PDF here, then downloads the "signed" version later.

**Files:**
- Modify: `server.js` — insert document routes after the signer routes

- [ ] **Step 1: Add document routes**

Insert after the contacts route and before `app.get('/health', ...)`:

```js
// ── Documents ─────────────────────────────────────────────────────────────────
app.post('/signature_requests/:srId/documents', upload.single('file'), (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });

  const doc = {
    id: `doc-${uuidv4()}`,
    name: req.body.name || req.file?.originalname || 'document.pdf',
    nature: req.body.nature || 'signable_document',
    created_at: new Date().toISOString(),
    _buffer: req.file?.buffer || FAKE_PDF,
  };
  documents.set(doc.id, doc);
  sr.documentIds.push(doc.id);
  log('[DOC] Uploaded', { srId: req.params.srId, docId: doc.id, bytes: doc._buffer.length });
  const { _buffer, ...resp } = doc;
  res.status(201).json(resp);
});

app.get('/signature_requests/:srId/documents', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });
  const docs = sr.documentIds.map(id => {
    const { _buffer, ...d } = documents.get(id);
    return d;
  });
  res.json(docs);
});

app.get('/signature_requests/:srId/documents/:docId/download', (req, res) => {
  const doc = documents.get(req.params.docId);
  if (!doc) return res.status(404).json({ detail: 'Not found', status: 404 });
  log('[DOWNLOAD]', { docId: req.params.docId });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${doc.name}"`);
  res.send(doc._buffer);
});

app.post('/signature_requests/:srId/documents/:docId/fields', (req, res) => {
  log('[FIELD] Added', { docId: req.params.docId });
  res.status(201).json({ id: `field-${uuidv4()}`, ...req.body });
});
```

- [ ] **Step 2: Verify upload + download**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1

SR=$(curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"T"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

DOC=$(curl -s -X POST "http://localhost:4099/signature_requests/$SR/documents" \
  -F "name=test.pdf" -F "nature=signable_document" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

curl -s -o /tmp/out.pdf "http://localhost:4099/signature_requests/$SR/documents/$DOC/download"
file /tmp/out.pdf

kill %1
```

Expected: `/tmp/out.pdf: PDF document, version 1.4`

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add document upload, download and field routes"
```

---

## Task 5: Activate Route + Webhook Fire

The core of the mock: `activate` schedules the webhook, `fireWebhook` sends it.

**Files:**
- Modify: `server.js` — add `fireWebhook` function and activate route

- [ ] **Step 1: Add `fireWebhook` function**

Insert after the `log` function definition and before the route definitions:

```js
// ── Webhook fire ──────────────────────────────────────────────────────────────
async function fireWebhook(srId, event) {
  const sr = signatureRequests.get(srId);
  if (!sr) return;

  const isDeclined = event === 'declined';
  sr.status = isDeclined ? 'declined' : 'done';

  const payload = isDeclined
    ? {
        event_name: 'signature_request.declined',
        data: { signature_request: { id: srId, status: 'declined' } },
      }
    : {
        event_name: 'signature_request.completed',
        data: {
          signature_request: {
            id: srId,
            status: 'done',
            documents: sr.documentIds.map(id => ({ id })),
          },
        },
      };

  const target = process.env.WEBHOOK_TARGET || WEBHOOK_TARGET;
  log(`[WEBHOOK] Firing ${event || 'completed'}`, { target, srId });

  try {
    const resp = await axios.post(target, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });
    log('[WEBHOOK] OK', { status: resp.status });
  } catch (err) {
    log('[WEBHOOK] ERROR', { message: err.message, body: err.response?.data });
  }
}
```

- [ ] **Step 2: Add activate route**

Insert after the document routes and before `app.get('/health', ...)`:

```js
// ── Activate ──────────────────────────────────────────────────────────────────
app.post('/signature_requests/:srId/activate', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });

  sr.status = 'ongoing';
  const delay = parseInt(process.env.AUTO_COMPLETE_DELAY_MS || AUTO_COMPLETE_DELAY_MS, 10);
  log(`[ACTIVATE] SR ${req.params.srId} — webhook fires in ${delay}ms`);

  res.json({ id: sr.id, status: sr.status });
  setTimeout(() => fireWebhook(sr.id), delay);
});
```

- [ ] **Step 3: Verify webhook fires**

Open two terminals.

Terminal 1 — start a tiny receiver:
```bash
node -e "
const http = require('http');
http.createServer((req, res) => {
  let b = '';
  req.on('data', d => b += d);
  req.on('end', () => { console.log('GOT WEBHOOK:', b); res.end('ok'); });
}).listen(9999, () => console.log('Receiver on :9999'));
"
```

Terminal 2:
```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
AUTO_COMPLETE_DELAY_MS=2000 WEBHOOK_TARGET=http://localhost:9999 node server.js &
sleep 1

SR=$(curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

curl -s -X POST "http://localhost:4099/signature_requests/$SR/activate" \
  -H "Content-Type: application/json" -d '{}'

sleep 3
kill %1
```

Expected in Terminal 1 after ~2s:
```
GOT WEBHOOK: {"event_name":"signature_request.completed","data":{"signature_request":{"id":"sr-...","status":"done","documents":[]}}}
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add activate route with auto webhook fire"
```

---

## Task 6: Admin JSON Endpoints

Manual control during testing — complete or fail an SR instantly, inspect all SRs.

**Files:**
- Modify: `server.js` — add admin routes before `app.get('/health', ...)`

- [ ] **Step 1: Add admin routes**

```js
// ── Admin ─────────────────────────────────────────────────────────────────────
app.get('/admin/requests', (req, res) => {
  const list = Array.from(signatureRequests.values()).map(sr => ({
    id: sr.id,
    name: sr.name,
    status: sr.status,
    documents: sr.documentIds.length,
    signers: sr.signerIds.length,
    created_at: sr.created_at,
  }));
  res.json(list);
});

app.post('/admin/complete/:srId', async (req, res) => {
  if (!signatureRequests.has(req.params.srId))
    return res.status(404).json({ error: 'SR not found' });
  await fireWebhook(req.params.srId, 'completed');
  res.json({ ok: true, srId: req.params.srId, event: 'completed' });
});

app.post('/admin/fail/:srId', async (req, res) => {
  if (!signatureRequests.has(req.params.srId))
    return res.status(404).json({ error: 'SR not found' });
  await fireWebhook(req.params.srId, 'declined');
  res.json({ ok: true, srId: req.params.srId, event: 'declined' });
});
```

- [ ] **Step 2: Verify**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1
curl -s http://localhost:4099/admin/requests
kill %1
```

Expected: `[]`

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add admin complete/fail/list endpoints"
```

---

## Task 7: HTML Dashboard

A single inline HTML page at `GET /dashboard`. Auto-refreshes every 3s, shows all SRs, has complete/decline buttons per row.

**Files:**
- Modify: `server.js` — add dashboard route before `app.get('/health', ...)`

- [ ] **Step 1: Add dashboard route**

```js
// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Yousign Mock</title>
  <style>
    body { font-family: monospace; padding: 24px; background: #0f0f0f; color: #e0e0e0; }
    h1 { color: #fff; margin-bottom: 4px; }
    p.cfg { color: #888; margin: 0 0 24px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; background: #1e1e1e; color: #aaa; font-size: 12px; }
    td { padding: 8px 12px; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
    tr:hover td { background: #1a1a1a; }
    .status-draft    { color: #888; }
    .status-ongoing  { color: #60a5fa; }
    .status-done     { color: #4ade80; }
    .status-declined { color: #f87171; }
    button { padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 4px; }
    .btn-complete { background: #166534; color: #4ade80; }
    .btn-complete:hover { background: #14532d; }
    .btn-fail     { background: #7f1d1d; color: #f87171; }
    .btn-fail:hover { background: #6b1a1a; }
    .empty { color: #555; padding: 24px 0; }
  </style>
</head>
<body>
  <h1>Yousign Mock</h1>
  <p class="cfg">WEBHOOK_TARGET: ${process.env.WEBHOOK_TARGET || WEBHOOK_TARGET} &nbsp;|&nbsp; DELAY: ${process.env.AUTO_COMPLETE_DELAY_MS || AUTO_COMPLETE_DELAY_MS}ms</p>
  <div id="root">Lade...</div>
  <script>
    async function action(url) {
      await fetch(url, { method: 'POST' });
      render();
    }
    async function render() {
      const res = await fetch('/admin/requests');
      const srs = await res.json();
      const root = document.getElementById('root');
      if (!srs.length) {
        root.innerHTML = '<p class="empty">Keine Signature Requests</p>';
        return;
      }
      root.innerHTML = \`<table>
        <thead><tr>
          <th>ID</th><th>Name</th><th>Status</th><th>Docs</th><th>Signers</th><th>Erstellt</th><th>Aktionen</th>
        </tr></thead>
        <tbody>\${srs.map(sr => \`<tr>
          <td title="\${sr.id}">\${sr.id.slice(0, 14)}…</td>
          <td>\${sr.name || '—'}</td>
          <td class="status-\${sr.status}">\${sr.status}</td>
          <td>\${sr.documents}</td>
          <td>\${sr.signers}</td>
          <td>\${new Date(sr.created_at).toLocaleTimeString('de')}</td>
          <td>
            <button class="btn-complete" onclick="action('/admin/complete/\${sr.id}')">✅ Abschließen</button>
            <button class="btn-fail"     onclick="action('/admin/fail/\${sr.id}')">❌ Ablehnen</button>
          </td>
        </tr>\`).join('')}</tbody>
      </table>\`;
    }
    render();
    setInterval(render, 3000);
  </script>
</body>
</html>`);
});
```

- [ ] **Step 2: Verify dashboard loads**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1
curl -s http://localhost:4099/dashboard | grep -c "Yousign Mock"
kill %1
```

Expected: `1`

- [ ] **Step 3: Open in browser and create a test SR, verify it appears**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
node server.js &
sleep 1

curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"Dashboard Test"}'

open http://localhost:4099/dashboard
```

Expected: Dashboard shows one row with name "Dashboard Test", status "draft", two buttons.

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add HTML dashboard with auto-refresh and action buttons"
```

---

## Task 8: README + d24-backend Wiring

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# d24-yousign-mock

Lokaler Yousign API v3 Mock für d24-backend Signing-Tests.

## Start

```bash
cp .env.example .env   # einmalig
npm install            # einmalig
npm run dev            # startet mit --watch
```

Dashboard: http://localhost:4099/dashboard

## Config (.env)

| Variable | Default | Beschreibung |
|---|---|---|
| `PORT` | `4099` | Port dieses Mocks |
| `WEBHOOK_TARGET` | `http://localhost:5019/signing/webhook/yousign` | Wohin der Webhook gefeuert wird |
| `AUTO_COMPLETE_DELAY_MS` | `5000` | ms nach activate() bis Webhook automatisch feuert |

## d24-backend verbinden

In d24-backend `.env`:
```env
YOUSIGN_BASE_URL=http://localhost:4099
YOUSIGN_API_KEY=mock-key-anything
```

Dann d24-backend neu starten.

## Admin Endpoints

| Endpoint | Beschreibung |
|---|---|
| `GET  /health` | Status + aktuelle Config |
| `GET  /dashboard` | HTML-Dashboard |
| `GET  /admin/requests` | Alle SRs als JSON |
| `POST /admin/complete/:srId` | Webhook `completed` sofort feuern |
| `POST /admin/fail/:srId` | Webhook `declined` sofort feuern |
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add README.md
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "docs: add README with start guide and d24-backend wiring"
```

---

## Self-Review

**Spec coverage:**
- ✅ All 10 Yousign API endpoints — Tasks 3, 4, 5
- ✅ In-memory store (signatureRequests, documents, signers, contacts) — Task 2
- ✅ Fake PDF — Task 2 (FAKE_PDF constant)
- ✅ WEBHOOK_TARGET via .env only — Task 1 + Task 5
- ✅ Auto-complete after delay — Task 5
- ✅ `signature_request.completed` payload — Task 5
- ✅ `signature_request.declined` payload — Task 5 (fireWebhook with event param)
- ✅ HTML Dashboard with auto-refresh + complete/decline buttons — Task 7
- ✅ Status colors (draft/ongoing/done/declined) — Task 7
- ✅ `/admin/complete/:srId` and `/admin/fail/:srId` — Task 6
- ✅ README + d24-backend wiring — Task 8

**Placeholder scan:** No TBDs, all steps have concrete code and commands.

**Type consistency:** `fireWebhook(srId, event)` defined in Task 5, called with `'completed'` and `'declined'` in Task 6. `signatureRequests`, `documents`, `signers`, `contacts`, `FAKE_PDF` defined in Task 2, referenced consistently in Tasks 3–7.
