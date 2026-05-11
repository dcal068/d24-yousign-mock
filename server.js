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
