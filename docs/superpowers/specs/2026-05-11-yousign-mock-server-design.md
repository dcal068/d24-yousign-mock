# Yousign Mock Server — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

---

## Goal

A standalone single-file Express server that mimics the Yousign API v3 locally, so d24-backend can run its full signing flow (create SR → upload PDF → add signer → activate → receive webhook) without hitting the real Yousign API.

---

## Architecture

Single file: `server.js`. No build tools, no framework overhead. Express + multer + axios + uuid.

In-memory Maps hold all state — everything resets on restart, which is intentional for a local dev tool.

```
d24-backend
    │  Yousign API calls (see endpoint list below)
    ▼
d24-yousign-mock :4099
    │  After activate() → setTimeout(delay) →
    ▼
d24-backend POST /signing/webhook/yousign
```

---

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4099` | Port this mock listens on |
| `WEBHOOK_TARGET` | `http://localhost:5019/signing/webhook/yousign` | Where to POST the webhook |
| `AUTO_COMPLETE_DELAY_MS` | `5000` | ms after activate() before auto-firing webhook |

The webhook target is only configurable via `.env` — no runtime config endpoint.

---

## In-Memory Store

```
signatureRequests  Map<srId, SR>
  SR: { id, name, external_id, delivery_mode, ordered_signers, status, created_at, documentIds[], signerIds[] }

documents          Map<docId, Doc>
  Doc: { id, name, nature, created_at, _buffer (Buffer) }

signers            Map<signerId, Signer>
  Signer: { id, contact_id, contact, signature_level, signature_authentication_mode, status }

contacts           Map<contactId, Contact>   ← seeded with one mock contact
  Contact: { id, email, first_name, last_name }
```

Status values for SR: `draft` → `ongoing` → `done` | `declined`

---

## Yousign API Endpoints Mocked

| Method | Path | What it does |
|---|---|---|
| `POST` | `/signature_requests` | Create SR → returns `{ id, status: "draft", ... }` |
| `GET` | `/signature_requests/:srId` | Get SR by id |
| `POST` | `/signature_requests/:srId/documents` | Multipart upload → stores buffer, returns `{ id, name, nature }` |
| `GET` | `/signature_requests/:srId/documents` | List docs for SR |
| `GET` | `/signature_requests/:srId/documents/:docId/download` | Returns the uploaded buffer as PDF (Content-Type: application/pdf) |
| `POST` | `/signature_requests/:srId/documents/:docId/fields` | Acknowledge signature field position → returns `{ id, ...body }` |
| `POST` | `/signature_requests/:srId/signers` | Add signer → returns signer object |
| `GET` | `/signature_requests/:srId/signers` | List signers for SR |
| `POST` | `/signature_requests/:srId/activate` | Set status=ongoing, schedule webhook fire after delay |
| `GET` | `/contacts/:contactId` | Return contact (seeded mock or passthrough stub) |

All endpoints require `Authorization: Bearer <anything>` header — the mock **does not validate** the key.

---

## Webhook Fire

**Trigger:** `POST /signature_requests/:srId/activate` → `setTimeout(fireWebhook, AUTO_COMPLETE_DELAY_MS)`

**Completed payload:**
```json
{
  "event_name": "signature_request.completed",
  "data": {
    "signature_request": {
      "id": "sr-xxx",
      "status": "done",
      "documents": [{ "id": "doc-xxx" }, ...]
    }
  }
}
```

**Declined payload** (only via admin trigger):
```json
{
  "event_name": "signature_request.declined",
  "data": {
    "signature_request": {
      "id": "sr-xxx",
      "status": "declined"
    }
  }
}
```

Both are POSTed to `WEBHOOK_TARGET` with `Content-Type: application/json`. Errors are logged but do not crash the server.

---

## Admin Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Status, SR count, current config |
| `GET` | `/admin/requests` | JSON list of all SRs |
| `POST` | `/admin/complete/:srId` | Immediately fire `signature_request.completed` (no delay) |
| `POST` | `/admin/fail/:srId` | Immediately fire `signature_request.declined` |

---

## HTML Dashboard (`GET /dashboard`)

Inline HTML served by Express (no separate files, no CSS framework).

- **Auto-refresh** every 3 seconds via `setInterval` + `fetch /admin/requests`
- **Table** columns: SR ID (truncated), Name, Status (color-coded), Docs, Signers, Created
- **Per-row buttons:**
  - ✅ "Abschließen" → `POST /admin/complete/:srId` → refreshes table
  - ❌ "Ablehnen" → `POST /admin/fail/:srId` → refreshes table
- Status colors: `draft`=grey, `ongoing`=blue, `done`=green, `declined`=red
- Empty state: "Keine Signature Requests" when map is empty

---

## Fake PDF

A hardcoded minimal valid PDF buffer (constant in `server.js`). Returned for all document downloads. ~200 bytes, enough for d24-backend to write it to disk without errors.

---

## File Structure

```
d24-yousign-mock/
  server.js          ← entire mock (single file)
  package.json
  .env.example
  .gitignore
  README.md
```

---

## Wiring d24-backend

In d24-backend `.env`:
```env
YOUSIGN_BASE_URL=http://localhost:4099
YOUSIGN_API_KEY=mock-key-anything
```

Restart d24-backend. All Yousign calls now hit the mock.
