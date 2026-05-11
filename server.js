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

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));

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
