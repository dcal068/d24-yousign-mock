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
