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
