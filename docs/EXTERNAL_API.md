# OmniDesk External API Documentation

## Overview

The External API allows third-party applications to send WhatsApp messages through OmniDesk using Twilio's WhatsApp Business API. All messages are processed through pre-approved message templates.

**Base URL:** `https://omnidesk.maxnetplus.id/api/external`

## Authentication

All API requests require HMAC-SHA256 authentication.

### Required Headers

| Header | Description |
|--------|-------------|
| `X-Client-ID` | Your API client ID (e.g., `odk_4d2d748b2e9e862269bf0f48`) |
| `X-Timestamp` | Unix timestamp in milliseconds |
| `X-Signature` | HMAC-SHA256 signature |
| `Content-Type` | `application/json` |

### Generating the Signature

```javascript
const crypto = require('crypto');

function generateSignature(clientId, secretKey, timestamp, body) {
  const payload = `${clientId}:${timestamp}:${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
}

// Example usage
const clientId = 'odk_4d2d748b2e9e862269bf0f48';
const secretKey = 'your-secret-key';
const timestamp = Date.now().toString();
const body = { request_id: 'inv_001', phone_number: '6281234567890', ... };

const signature = generateSignature(clientId, secretKey, timestamp, body);
```

### Signature Validation

- Signatures expire after 5 minutes
- Replay attacks are prevented via request_id deduplication

---

## Endpoints

### Send Single Message

**POST** `/api/external/messages`

Send a single WhatsApp message to a recipient.

#### Request Body

```json
{
  "request_id": "inv_new_008",
  "phone_number": "6285255769832",
  "recipient_name": "Denis",
  "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
  "priority": 0,
  "scheduled_at": "2026-01-18T10:00:00Z",
  "metadata": {
    "messageType": "new_invoice",
    "grand_total": "123000",
    "invoice_number": "INV260113421"
  }
}
```

#### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | string | Yes | Unique identifier for idempotency (prevents duplicate sends) |
| `phone_number` | string | Yes | Recipient's phone number (with or without + prefix) |
| `recipient_name` | string | No | Recipient's name for personalization |
| `message` | string | Yes | Primary message content (used as invoice_url in templates) |
| `priority` | number | No | Priority 0-100, higher = processed first (default: 0) |
| `scheduled_at` | string | No | ISO 8601 datetime for scheduled delivery |
| `metadata` | object | No | Additional data for template variables |

#### Metadata Fields

| Field | Type | Description | Template Variable |
|-------|------|-------------|-------------------|
| `messageType` | string | Message type for greeting text | → `message_type` text |
| `invoice_number` | string | Invoice ID | → `{{2}}` or `{{3}}` |
| `grand_total` | string/number | Amount (auto-formatted with thousand separators) | → `{{3}}` or `{{4}}` |

#### Message Type Values

| messageType | Generated Text |
|-------------|----------------|
| `new_invoice` | "Tagihan internet Anda telah terbit:" |
| `reminder` | "Pengingat pembayaran untuk:" |
| `overdue` | "Tagihan Anda telah melewati jatuh tempo:" |
| `payment_confirmation` | "Terima kasih! Pembayaran Anda telah kami terima untuk:" |
| (other/default) | "Informasi tagihan internet Anda:" |

#### Success Response (201 Created)

```json
{
  "success": true,
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "request_id": "inv_new_008",
  "status": "queued",
  "template_applied": true,
  "template_name": "invoice_reminder_1328e655",
  "matched_by": "default",
  "created_at": "2026-01-18T10:17:17.244Z"
}
```

#### Error Responses

**400 Bad Request** - Validation failed
```json
{
  "error": "Validation failed",
  "details": [{ "path": ["phone_number"], "message": "Required" }]
}
```

**400 Bad Request** - No template matched
```json
{
  "error": "Template required",
  "message": "No applicable message template found. External API requires a valid message template to be configured or matched.",
  "request_id": "inv_new_008"
}
```

**401 Unauthorized** - Authentication failed
```json
{
  "error": "Missing required headers"
}
```

**409 Conflict** - Duplicate request_id
```json
{
  "error": "Duplicate request_id",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "sent"
}
```

**429 Too Many Requests** - Rate limit exceeded
```json
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

---

### Send Bulk Messages

**POST** `/api/external/messages/bulk`

Send multiple messages in a single request (max 100).

#### Request Body

```json
{
  "messages": [
    {
      "request_id": "inv_001",
      "phone_number": "6281234567890",
      "recipient_name": "Budi",
      "message": "https://invoice.maxnetplus.id/inv/abc123",
      "metadata": {
        "messageType": "new_invoice",
        "grand_total": "250000",
        "invoice_number": "INV260118001"
      }
    },
    {
      "request_id": "inv_002",
      "phone_number": "6289876543210",
      "recipient_name": "Siti",
      "message": "https://invoice.maxnetplus.id/inv/def456",
      "metadata": {
        "messageType": "reminder",
        "grand_total": "175000",
        "invoice_number": "INV260118002"
      }
    }
  ]
}
```

#### Success Response (201 Created)

```json
{
  "success": true,
  "total": 2,
  "queued": 2,
  "failed": 0,
  "results": [
    {
      "request_id": "inv_001",
      "message_id": "...",
      "status": "queued",
      "template_applied": true
    },
    {
      "request_id": "inv_002",
      "message_id": "...",
      "status": "queued",
      "template_applied": true
    }
  ]
}
```

---

### Check Message Status

**GET** `/api/external/messages/:request_id`

Get the status of a previously sent message.

#### Success Response (200 OK)

```json
{
  "request_id": "inv_new_008",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "sent",
  "phone_number": "6285255769832",
  "created_at": "2026-01-18T10:17:17.244Z",
  "sent_at": "2026-01-18T10:19:30.000Z"
}
```

#### Status Values

| Status | Description |
|--------|-------------|
| `queued` | Message is waiting in queue |
| `processing` | Message is being processed |
| `sending` | Message is being sent to Twilio |
| `sent` | Message successfully delivered to Twilio |
| `failed` | Message delivery failed |
| `cancelled` | Message was cancelled before sending |

---

## Template System

### How Templates Work

1. **API Client Default**: If your API client has a default template configured, it will be used
2. **Message Type Match**: Templates can be matched by `messageType` in metadata
3. **Trigger Rules**: Templates can have custom trigger rules based on metadata
4. **Default Fallback**: If no specific match, the default template is used

### Current Templates

#### Template 1: `invoice_reminder_1328e655`

**Content:**
```
Yth. {{1}},

{{5}}

Nomor Invoice: {{2}}
Total Tagihan: Rp {{3}}

Untuk melihat detail dan pembayaran, silakan klik:
{{4}}

Jika sudah melakukan pembayaran, mohon abaikan pesan ini.

Terima kasih,
MAXNET Customer Care
wa.me/6208991066262
```

**Variable Mapping:**
| Placeholder | Variable Name | Source |
|-------------|---------------|--------|
| {{1}} | recipient_name | `recipient_name` field |
| {{2}} | invoice_number | `metadata.invoice_number` |
| {{3}} | grand_total | `metadata.grand_total` (auto-formatted) |
| {{4}} | invoice_url | `message` field |
| {{5}} | message_type | Generated from `metadata.messageType` |

#### Template 2: `invoice_reminder_1768637738262`

**Content:**
```
Yth. {{1}},

{{2}}

Nomor Invoice: {{3}}
Total Tagihan: Rp {{4}}

Untuk melihat detail dan pembayaran, silakan klik:
{{5}}

Jika sudah melakukan pembayaran, mohon abaikan pesan ini.

Terima kasih,
MAXNET Customer Care
wa.me/6208991066262
```

**Variable Mapping:**
| Placeholder | Variable Name | Source |
|-------------|---------------|--------|
| {{1}} | recipient_name | `recipient_name` field |
| {{2}} | message_type | Generated from `metadata.messageType` |
| {{3}} | invoice_number | `metadata.invoice_number` |
| {{4}} | grand_total | `metadata.grand_total` (auto-formatted) |
| {{5}} | invoice_url | `message` field |

---

## Rate Limiting

| Limit Type | Default | Header |
|------------|---------|--------|
| Per Minute | 60 requests | `X-RateLimit-Limit` |
| Per Day | 1000 requests | `X-RateLimit-Daily-Limit` |
| Remaining (minute) | - | `X-RateLimit-Remaining` |
| Remaining (daily) | - | `X-RateLimit-Daily-Remaining` |
| Reset Time | - | `X-RateLimit-Reset` |

---

## Message Queue Behavior

- Messages are queued and processed with 2-3 minute intervals
- Messages are only sent between **7 AM - 9 PM Jakarta time (WIB)**
- Messages scheduled outside this window are held until the next valid window
- Higher priority messages (higher number) are processed first

---

## IP Whitelisting

If configured, only requests from whitelisted IPs will be accepted. The system supports:
- Direct IP addresses
- Cloudflare's `CF-Connecting-IP` header for proxied requests

---

## URL Shortening

All URLs in messages are automatically shortened to prevent WhatsApp detection/blocking:
- Original: `https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6`
- Shortened: `https://omnidesk.maxnetplus.id/s/abc123`

The shortened URLs use JavaScript-based redirects (not HTTP 301) so WhatsApp's link preview cannot detect the final domain.

---

## Complete Example

### cURL Request

```bash
#!/bin/bash

CLIENT_ID="odk_4d2d748b2e9e862269bf0f48"
SECRET_KEY="your-secret-key-here"
TIMESTAMP=$(date +%s000)
BASE_URL="https://omnidesk.maxnetplus.id"

BODY='{
  "request_id": "inv_new_008",
  "phone_number": "6285255769832",
  "recipient_name": "Denis",
  "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
  "metadata": {
    "messageType": "new_invoice",
    "grand_total": "123000",
    "invoice_number": "INV260113421"
  }
}'

# Generate signature
PAYLOAD="${CLIENT_ID}:${TIMESTAMP}:${BODY}"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET_KEY" | cut -d' ' -f2)

curl -X POST "${BASE_URL}/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "X-Client-ID: ${CLIENT_ID}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Signature: ${SIGNATURE}" \
  -d "$BODY"
```

### PHP Example

```php
<?php

$clientId = 'odk_4d2d748b2e9e862269bf0f48';
$secretKey = 'your-secret-key-here';
$baseUrl = 'https://omnidesk.maxnetplus.id';

$body = [
    'request_id' => 'inv_new_' . time(),
    'phone_number' => '6285255769832',
    'recipient_name' => 'Denis',
    'message' => 'https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6',
    'metadata' => [
        'messageType' => 'new_invoice',
        'grand_total' => '123000',
        'invoice_number' => 'INV260113421'
    ]
];

$timestamp = round(microtime(true) * 1000);
$bodyJson = json_encode($body);
$payload = "{$clientId}:{$timestamp}:{$bodyJson}";
$signature = hash_hmac('sha256', $payload, $secretKey);

$ch = curl_init("{$baseUrl}/api/external/messages");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $bodyJson,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "X-Client-ID: {$clientId}",
        "X-Timestamp: {$timestamp}",
        "X-Signature: {$signature}"
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "HTTP Code: {$httpCode}\n";
echo "Response: {$response}\n";
```

### Node.js Example

```javascript
const crypto = require('crypto');
const https = require('https');

const clientId = 'odk_4d2d748b2e9e862269bf0f48';
const secretKey = 'your-secret-key-here';

const body = {
  request_id: `inv_new_${Date.now()}`,
  phone_number: '6285255769832',
  recipient_name: 'Denis',
  message: 'https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6',
  metadata: {
    messageType: 'new_invoice',
    grand_total: '123000',
    invoice_number: 'INV260113421'
  }
};

const timestamp = Date.now().toString();
const bodyJson = JSON.stringify(body);
const payload = `${clientId}:${timestamp}:${bodyJson}`;
const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');

const options = {
  hostname: 'omnidesk.maxnetplus.id',
  path: '/api/external/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Client-ID': clientId,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${data}`);
  });
});

req.write(bodyJson);
req.end();
```

---

## Support

For API access or issues, contact the OmniDesk administrator.
