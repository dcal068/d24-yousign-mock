# Yousign Mock Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Express.js server that mimics the Yousign API v3, so d24-backend can create signature requests locally without hitting the real Yousign API — and auto-fires the signed webhook back after a configurable delay.

**Architecture:** Single-file Express server with in-memory store for signature requests, documents, and signers. On `POST /signature_requests/:id/activate`, a timer fires that POSTs `signature_request.completed` to d24-backend's webhook endpoint. Admin routes allow manual triggering and runtime inspection.

**Tech Stack:** Node.js, Express 4, multer (multipart uploads), axios (outgoing webhook), uuid, dotenv

---

> **Note:** `package.json` and a draft `server.js` were partially created before this plan was written. Task 1 will overwrite/finalize them cleanly.

---

## File Map

| File | Role |
|---|---|
| `package.json` | Dependencies and npm scripts |
| `.env.example` | Documented config template |
| `server.js` | Full Express mock server (single responsibility: mock Yousign) |
| `README.md` | How to start and test |

---

## Task 1: Project Setup

**Files:**
- Overwrite: `package.json`
- Create: `.env.example`
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
# Port this mock server listens on
PORT=4099

# Where d24-backend's Yousign webhook lives
WEBHOOK_TARGET=http://localhost:5019/signing/webhook/yousign

# Milliseconds after activate() before the mock fires "signature_request.completed"
AUTO_COMPLETE_DELAY_MS=5000
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/denizcaliskan/dcal/d24-yousign-mock
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock init
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add package.json .env.example .gitignore
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "chore: init project with deps"
```

---

## Task 2: In-Memory Store + Server Bootstrap

**Files:**
- Create/Overwrite: `server.js` (bootstrap only — routes added in Tasks 3–6)

- [ ] **Step 1: Write server bootstrap in `server.js`**

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

// In-memory store
const signatureRequests = new Map(); // srId → { id, name, status, documentIds[], signerIds[] }
const documents = new Map();         // docId → { id, name, nature, _buffer }
const signers = new Map();           // signerId → { id, contact_id, contact, status, ... }

// Seed one mock contact so d24-backend's contact lookups don't 404
const contacts = new Map([
  ['contact-doctor-1', {
    id: 'contact-doctor-1',
    email: 'doctor@test.de',
    first_name: 'Max',
    last_name: 'Mustermann',
  }],
]);

function log(msg, data) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`, data ? JSON.stringify(data) : '');
}

// Health
app.get('/health', (req, res) => res.json({
  ok: true,
  signatureRequests: signatureRequests.size,
  webhookTarget: WEBHOOK_TARGET,
  autoCompleteDelayMs: AUTO_COMPLETE_DELAY_MS,
}));

app.listen(PORT, () => {
  console.log(`\nYousign Mock API → http://localhost:${PORT}`);
  console.log(`  WEBHOOK_TARGET      = ${WEBHOOK_TARGET}`);
  console.log(`  AUTO_COMPLETE_DELAY = ${AUTO_COMPLETE_DELAY_MS}ms\n`);
});

module.exports = { app, signatureRequests, documents, signers, contacts, log, uuidv4 };
```

- [ ] **Step 2: Verify server starts**

```bash
node /Users/denizcaliskan/dcal/d24-yousign-mock/server.js &
curl http://localhost:4099/health
```

Expected:
```json
{"ok":true,"signatureRequests":0,"webhookTarget":"http://localhost:5019/signing/webhook/yousign","autoCompleteDelayMs":5000}
```

Kill the process after verifying: `kill %1`

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: bootstrap express server with in-memory store"
```

---

## Task 3: Signature Request + Signer + Contact Routes

These are the routes d24-backend calls to set up a signing session.

**Files:**
- Modify: `server.js` — add routes before `app.listen`

- [ ] **Step 1: Add signature request routes**

Insert before `app.listen(...)`:

```js
// POST /signature_requests → create
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
  const { documentIds, signerIds, ...response } = sr;
  res.status(201).json(response);
});

// GET /signature_requests/:srId
app.get('/signature_requests/:srId', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'Not found', status: 404 });
  const { documentIds, signerIds, ...response } = sr;
  res.json(response);
});

// POST /signature_requests/:srId/signers
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
  log('[SIGNER] Added', { srId: req.params.srId, signerId: signer.id, contactId: signer.contact_id });
  res.status(201).json(signer);
});

// GET /signature_requests/:srId/signers
app.get('/signature_requests/:srId/signers', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });
  res.json(sr.signerIds.map(id => signers.get(id)));
});

// GET /contacts/:contactId
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

- [ ] **Step 2: Verify manually**

```bash
node server.js &

# Create SR
curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"Test SR","delivery_mode":"none"}' | jq .

# Should return: { "id": "sr-...", "status": "draft", ... }

kill %1
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add signature request, signer and contact routes"
```

---

## Task 4: Document Upload + Download + Field Routes

d24-backend uploads the prescription PDF here, then downloads the "signed" version later.

**Files:**
- Modify: `server.js` — add document routes before `app.listen`

- [ ] **Step 1: Add a minimal fake PDF constant** (after the `contacts` Map declaration)

```js
// Minimal valid PDF returned when no real file was uploaded
const FAKE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
  '0000000058 00000 n\n0000000115 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
);
```

- [ ] **Step 2: Add document routes** (before `app.listen`)

```js
// POST /signature_requests/:srId/documents  (multipart upload)
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
  const { _buffer, ...response } = doc;
  res.status(201).json(response);
});

// GET /signature_requests/:srId/documents
app.get('/signature_requests/:srId/documents', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });
  const docs = sr.documentIds.map(id => {
    const { _buffer, ...d } = documents.get(id);
    return d;
  });
  res.json(docs);
});

// GET /signature_requests/:srId/documents/:docId/download
app.get('/signature_requests/:srId/documents/:docId/download', (req, res) => {
  const doc = documents.get(req.params.docId);
  if (!doc) return res.status(404).json({ detail: 'Not found', status: 404 });
  log('[DOWNLOAD] Doc', { docId: req.params.docId });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${doc.name}"`);
  res.send(doc._buffer);
});

// POST /signature_requests/:srId/documents/:docId/fields  (signature field positions)
app.post('/signature_requests/:srId/documents/:docId/fields', (req, res) => {
  log('[FIELD] Added', { docId: req.params.docId });
  res.status(201).json({ id: `field-${uuidv4()}`, ...req.body });
});
```

- [ ] **Step 3: Verify download returns a PDF**

```bash
node server.js &
SR=$(curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"T"}' | jq -r .id)

DOC=$(curl -s -X POST http://localhost:4099/signature_requests/$SR/documents \
  -F "file=@/dev/null;type=application/pdf" \
  -F "name=test.pdf" | jq -r .id)

curl -s -o /tmp/out.pdf "http://localhost:4099/signature_requests/$SR/documents/$DOC/download"
file /tmp/out.pdf
# Expected: /tmp/out.pdf: PDF document ...

kill %1
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add document upload, download and field routes"
```

---

## Task 5: Activate Route + Webhook Fire

This is the core: `activate` triggers an auto-complete timer that fires the Yousign webhook back at d24-backend.

**Files:**
- Modify: `server.js` — add `fireWebhook` function + activate route before `app.listen`

- [ ] **Step 1: Add `fireWebhook` function** (after the `contacts` Map)

```js
async function fireWebhook(srId) {
  const sr = signatureRequests.get(srId);
  if (!sr) return;

  sr.status = 'done';

  const payload = {
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
  log('[WEBHOOK] Firing', { target, srId, docs: sr.documentIds });

  try {
    const resp = await axios.post(target, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });
    log('[WEBHOOK] OK', { status: resp.status, body: resp.data });
  } catch (err) {
    log('[WEBHOOK] ERROR', { message: err.message, body: err.response?.data });
  }
}
```

- [ ] **Step 2: Add activate route** (before `app.listen`)

```js
// POST /signature_requests/:srId/activate
app.post('/signature_requests/:srId/activate', (req, res) => {
  const sr = signatureRequests.get(req.params.srId);
  if (!sr) return res.status(404).json({ detail: 'SR not found', status: 404 });

  sr.status = 'ongoing';
  const delay = parseInt(process.env.AUTO_COMPLETE_DELAY_MS || AUTO_COMPLETE_DELAY_MS, 10);
  log(`[ACTIVATE] SR ${req.params.srId} → will fire webhook in ${delay}ms`);

  res.json({ id: sr.id, status: sr.status });

  setTimeout(() => fireWebhook(sr.id), delay);
});
```

- [ ] **Step 3: Verify the full flow end-to-end (mock only, no d24-backend needed)**

Start a tiny webhook receiver in one terminal:
```bash
node -e "
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { console.log('RECEIVED:', body); res.end('ok'); });
}).listen(9999, () => console.log('Receiver on :9999'));
"
```

In another terminal:
```bash
WEBHOOK_TARGET=http://localhost:9999 AUTO_COMPLETE_DELAY_MS=2000 node server.js &

SR=$(curl -s -X POST http://localhost:4099/signature_requests \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Test"}' | jq -r .id)

curl -s -X POST http://localhost:4099/signature_requests/$SR/activate \
  -H "Content-Type: application/json" -d '{}'

# Wait 3 seconds — receiver terminal should print the webhook payload
sleep 3
kill %2
```

Expected in receiver terminal:
```
RECEIVED: {"event_name":"signature_request.completed","data":{"signature_request":{"id":"sr-...","status":"done","documents":[]}}}
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add activate route with auto webhook fire"
```

---

## Task 6: Admin Routes

Convenience routes for manual control during testing.

**Files:**
- Modify: `server.js` — add admin routes before `app.listen`

- [ ] **Step 1: Add admin routes**

```js
// POST /admin/complete/:srId  → manually trigger webhook (skip the timer)
app.post('/admin/complete/:srId', async (req, res) => {
  if (!signatureRequests.has(req.params.srId))
    return res.status(404).json({ error: 'SR not found' });
  await fireWebhook(req.params.srId);
  res.json({ ok: true, srId: req.params.srId });
});

// GET /admin/requests  → inspect all SRs
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

// POST /admin/config  → change webhookTarget at runtime without restart
app.post('/admin/config', (req, res) => {
  if (req.body.webhookTarget) {
    process.env.WEBHOOK_TARGET = req.body.webhookTarget;
    log('[CONFIG] webhookTarget updated', { target: req.body.webhookTarget });
  }
  res.json({ webhookTarget: process.env.WEBHOOK_TARGET || WEBHOOK_TARGET });
});
```

- [ ] **Step 2: Verify admin list endpoint**

```bash
node server.js &
curl -s http://localhost:4099/admin/requests | jq .
# Expected: []
kill %1
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "feat: add admin routes for manual control"
```

---

## Task 7: README + Wire Up Against d24-backend

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# d24-yousign-mock

Local Yousign API v3 mock for testing d24-backend signing flows.

## Start

```bash
cp .env.example .env
npm install
npm run dev
```

## Config (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4099` | Port this mock listens on |
| `WEBHOOK_TARGET` | `http://localhost:5019/signing/webhook/yousign` | d24-backend webhook URL |
| `AUTO_COMPLETE_DELAY_MS` | `5000` | ms after activate() before webhook fires |

## Wire up d24-backend

In d24-backend `.env`:
```env
YOUSIGN_BASE_URL=http://localhost:4099
YOUSIGN_API_KEY=mock-key-anything
```

## Admin endpoints

| Endpoint | Description |
|---|---|
| `GET  /health` | Status + config |
| `GET  /admin/requests` | List all SRs in memory |
| `POST /admin/complete/:srId` | Manually fire webhook for SR |
| `POST /admin/config` | Change webhookTarget at runtime |

## Full flow

1. Start this mock: `npm run dev`
2. Start d24-backend pointing at this mock
3. Create a prescription + sign it in the UI
4. After `AUTO_COMPLETE_DELAY_MS`, the mock fires the webhook
5. d24-backend processes it, downloads the (fake) PDF, publishes MQTT
6. d24-cannaelo-api picks it up via MQTT and forwards to Cannaelo
```

- [ ] **Step 2: Set d24-backend env and restart**

In `/Users/denizcaliskan/dcal/d24-backend/.env` (or `.env.local`), set:
```env
YOUSIGN_BASE_URL=http://localhost:4099
YOUSIGN_API_KEY=mock-key-anything
```

Restart d24-backend.

- [ ] **Step 3: Smoke test the full chain**

```bash
# 1. Start mock
cd /Users/denizcaliskan/dcal/d24-yousign-mock && npm start &

# 2. Ping mock
curl http://localhost:4099/health

# 3. Watch mock logs + trigger a real signing flow from the d24 UI
#    → after AUTO_COMPLETE_DELAY_MS the mock fires the webhook
#    → check d24 admin panel: Übertragungsprotokoll should show a new entry
```

- [ ] **Step 4: Final commit**

```bash
git -C /Users/denizcaliskan/dcal/d24-yousign-mock add README.md server.js
git -C /Users/denizcaliskan/dcal/d24-yousign-mock commit -m "docs: add README and finalize mock server"
```

---

## Self-Review

**Spec coverage:**
- ✅ `POST /signature_requests` — Task 3
- ✅ `POST /signature_requests/:id/documents` (multipart) — Task 4
- ✅ `POST /signature_requests/:id/signers` — Task 3
- ✅ `POST /signature_requests/:id/documents/:docId/fields` — Task 4
- ✅ `POST /signature_requests/:id/activate` + webhook fire — Task 5
- ✅ `GET /signature_requests/:id/documents` — Task 4
- ✅ `GET /signature_requests/:id/documents/:docId/download` — Task 4
- ✅ `GET /signature_requests/:id/signers` — Task 3
- ✅ `GET /contacts/:id` — Task 3
- ✅ Admin: manual trigger, list SRs, runtime config — Task 6
- ✅ README + d24-backend wiring — Task 7

**Placeholder scan:** No TBDs, no "add error handling later", all steps have concrete code/commands.

**Type consistency:** `signatureRequests`, `documents`, `signers`, `contacts` Maps are defined in Task 2 and referenced consistently in Tasks 3–6. `fireWebhook(srId)` defined in Task 5, called in Tasks 5 and 6.
