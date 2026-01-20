# OmniDesk External API Documentation

## Overview

The External API allows third-party applications to send WhatsApp messages through OmniDesk using Twilio's WhatsApp Business API. All messages are processed through pre-approved message templates with dynamic variable substitution.

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

The signature is generated using the format: `{clientId}.{timestamp}.{bodyJson}`

```javascript
const crypto = require('crypto');

function generateSignature(clientId, secretKey, timestamp, body) {
  const payload = `${clientId}.${timestamp}.${JSON.stringify(body)}`;
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

- Signatures expire after 10 minutes (clock drift tolerance)
- Replay attacks are prevented via request_id deduplication

---

## Endpoints

### Send Single Message

**POST** `/api/external/messages`

Send a single WhatsApp message to a recipient using the API client's linked template.

**Important:** Your API client must have a template linked in the Admin panel. The linked template must be:
- Active
- Synced to Twilio
- Approved by WhatsApp

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
  },
  "template_variables": {
    "recipient_name": "Denis",
    "invoice_number": "INV260113421",
    "grand_total": "123.000",
    "invoice_url": "https://invoice.maxnetplus.id/inv/abc123"
  }
}
```

#### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | string | Yes | Unique identifier for idempotency (prevents duplicate sends) |
| `phone_number` | string | Yes | Recipient's phone number (with or without + prefix) |
| `recipient_name` | string | No | Recipient's name for personalization |
| `message` | string | Yes | Primary message content (used as `invoice_url` in templates) |
| `priority` | number | No | Priority 0-100, higher = processed first (default: 0) |
| `scheduled_at` | string | No | ISO 8601 datetime for scheduled delivery |
| `metadata` | object | No | Additional data for template variables (legacy method) |
| `template_variables` | object | No | **Explicit template variable overrides** (recommended) |

#### Template Variable Resolution

Variables are resolved in the following priority order (highest to lowest):

1. **`template_variables`** - Explicit overrides in the request (recommended)
2. **`metadata`** - Legacy field mapping from metadata object
3. **Default values** - Built-in defaults (e.g., "Pelanggan" for recipient_name)

#### Explicit Template Variables (`template_variables`)

Use this field to directly specify values for each template placeholder. The keys should match your template's variable names.

```json
{
  "template_variables": {
    "recipient_name": "John Doe",
    "invoice_number": "INV-2026-001",
    "grand_total": "250.000",
    "invoice_url": "https://example.com/invoice/123",
    "message_type": "Tagihan baru untuk layanan internet Anda:"
  }
}
```

#### Legacy Metadata Fields

For backward compatibility, metadata fields are automatically mapped:

| Metadata Field | Template Variable | Notes |
|---------------|-------------------|-------|
| `messageType` | `message_type` | Converted to Indonesian text |
| `invoice_number` | `invoice_number` | Direct mapping |
| `grand_total` | `grand_total` | Auto-formatted with thousand separators |
| `recipient_name` | `recipient_name` | Falls back to top-level `recipient_name` |

#### Message Type Values (for `metadata.messageType`)

| messageType | Generated Text |
|-------------|----------------|
| `new_invoice` | "Berikut adalah tagihan baru untuk layanan internet Anda:" |
| `reminder_invoices` | "Kami mengingatkan tagihan internet Anda yang belum dibayar:" |
| `overdue` | "PENTING: Tagihan internet Anda sudah melewati jatuh tempo:" |
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
  "template_name": "invoice_reminder_v2",
  "matched_by": "client_linked",
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

**400 Bad Request** - No template linked
```json
{
  "error": "No template linked",
  "message": "API client \"MyClient\" does not have a message template linked. Please configure a template in Admin > API Message > API Clients.",
  "request_id": "inv_new_008"
}
```

**400 Bad Request** - Template not approved
```json
{
  "error": "Template not approved",
  "message": "Template \"invoice_reminder\" is not approved by WhatsApp (status: pending). Please wait for approval or use an approved template.",
  "request_id": "inv_new_008"
}
```

**401 Unauthorized** - Authentication failed
```json
{
  "error": "Missing authentication headers",
  "required": ["X-Client-Id", "X-Timestamp", "X-Signature"]
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
  "limit": 60,
  "remaining": 0,
  "reset_at": "2026-01-18T10:18:00.000Z"
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
      "template_variables": {
        "recipient_name": "Budi",
        "invoice_number": "INV260118001",
        "grand_total": "250.000"
      }
    },
    {
      "request_id": "inv_002",
      "phone_number": "6289876543210",
      "recipient_name": "Siti",
      "message": "https://invoice.maxnetplus.id/inv/def456",
      "template_variables": {
        "recipient_name": "Siti",
        "invoice_number": "INV260118002",
        "grand_total": "175.000"
      }
    }
  ]
}
```

#### Success Response (201 Created)

```json
{
  "total": 2,
  "success": 2,
  "failed": 0,
  "results": [
    {
      "request_id": "inv_001",
      "success": true,
      "message_id": "...",
      "template_applied": true
    },
    {
      "request_id": "inv_002",
      "success": true,
      "message_id": "...",
      "template_applied": true
    }
  ]
}
```

---

### Check Message Status

**GET** `/api/external/messages/:id`

Get the status of a previously sent message by message_id or request_id.

#### Success Response (200 OK)

```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "request_id": "inv_new_008",
  "phone_number": "6285255769832",
  "message": "Yth. Denis, ...",
  "status": "sent",
  "error_message": null,
  "external_message_id": "SM...",
  "scheduled_at": null,
  "sent_at": "2026-01-18T10:19:30.000Z",
  "created_at": "2026-01-18T10:17:17.244Z",
  "updated_at": "2026-01-18T10:19:30.000Z"
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

---

### Get Available Templates

**GET** `/api/external/templates`

Get a list of available templates for reference.

#### Success Response (200 OK)

```json
{
  "templates": [
    {
      "name": "invoice_reminder_v2",
      "description": "Invoice reminder with dynamic variables",
      "variables": ["recipient_name", "message_type", "invoice_number", "grand_total", "invoice_url"],
      "category": "UTILITY"
    }
  ]
}
```

---

### Get Client Status

**GET** `/api/external/status`

Get your API client's current status and queue information.

#### Success Response (200 OK)

```json
{
  "client_id": "odk_4d2d748b2e9e862269bf0f48",
  "name": "Invoice System",
  "is_active": true,
  "rate_limit_per_day": 1000,
  "requests_today": 45,
  "queue": {
    "queued": 5,
    "processing": 1,
    "sent_today": 39,
    "failed_today": 0
  }
}
```

---

## Template System

### How Templates Work

1. **Client Linked Template**: Each API client must have a template linked in the Admin panel
2. **Template Validation**: The linked template must be active, synced to Twilio, and approved by WhatsApp
3. **Variable Substitution**: Template placeholders ({{1}}, {{2}}, etc.) are replaced with values from your request

### Template Variable Mapping

Templates use numbered placeholders ({{1}}, {{2}}, etc.) which are mapped to named variables:

| Placeholder | Variable Name | Description |
|-------------|---------------|-------------|
| {{1}} | recipient_name | Customer/recipient name |
| {{2}} | message_type | Message type text (auto-generated from messageType) |
| {{3}} | invoice_number | Invoice/order number |
| {{4}} | grand_total | Amount (auto-formatted with thousand separators) |
| {{5}} | invoice_url | Link to invoice/payment page |

**Note:** Variable order may differ between templates. Check your template's configuration in the Admin panel.

### Custom Variable Mappings

API clients can configure custom variable mappings in the Admin panel to map API payload fields to template placeholders:

| Placeholder | Payload Field |
|-------------|---------------|
| {{1}} | recipient_name |
| {{2}} | metadata.messageType |
| {{3}} | metadata.invoice_number |
| {{4}} | metadata.grand_total |
| {{5}} | message |

### Example Template

**Template Name:** `invoice_reminder_v2`

**Content:**
```
Yth. {{1}},

{{2}}

Nomor Invoice: {{3}}
Total Tagihan: Rp {{4}}

Untuk melihat detail dan pembayaran:
{{5}}

Jika sudah melakukan pembayaran, mohon abaikan pesan ini.

Terima kasih,
MAXNET Customer Care
```

---

## Rate Limiting

| Limit Type | Default | Header |
|------------|---------|--------|
| Per Minute | 60 requests | `X-RateLimit-Limit` |
| Per Day | 1000 requests | `X-RateLimit-Daily-Limit` |
| Remaining (minute) | - | `X-RateLimit-Remaining` |
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

## Complete Examples

### cURL Request with Template Variables

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
  "template_variables": {
    "recipient_name": "Denis",
    "invoice_number": "INV260113421",
    "grand_total": "123.000",
    "message_type": "Tagihan baru untuk layanan internet Anda:"
  }
}'

# Generate signature (note the dot separator)
PAYLOAD="${CLIENT_ID}.${TIMESTAMP}.${BODY}"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET_KEY" | cut -d' ' -f2)

curl -X POST "${BASE_URL}/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "X-Client-ID: ${CLIENT_ID}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Signature: ${SIGNATURE}" \
  -d "$BODY"
```

### PHP Example with Template Variables

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
    'template_variables' => [
        'recipient_name' => 'Denis',
        'invoice_number' => 'INV260113421',
        'grand_total' => '123.000',
        'message_type' => 'Tagihan baru untuk layanan internet Anda:'
    ]
];

$timestamp = round(microtime(true) * 1000);
$bodyJson = json_encode($body);

// Note: signature uses dot (.) separator
$payload = "{$clientId}.{$timestamp}.{$bodyJson}";
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

### Node.js Example with Template Variables

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
  template_variables: {
    recipient_name: 'Denis',
    invoice_number: 'INV260113421',
    grand_total: '123.000',
    message_type: 'Tagihan baru untuk layanan internet Anda:'
  }
};

const timestamp = Date.now().toString();
const bodyJson = JSON.stringify(body);

// Note: signature uses dot (.) separator
const payload = `${clientId}.${timestamp}.${bodyJson}`;
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

## Migration Guide

### From Legacy Metadata to Template Variables

If you're using the legacy `metadata` field, consider migrating to `template_variables` for more control:

**Before (legacy):**
```json
{
  "request_id": "inv_001",
  "phone_number": "6281234567890",
  "recipient_name": "Budi",
  "message": "https://example.com/invoice/123",
  "metadata": {
    "messageType": "new_invoice",
    "grand_total": "250000",
    "invoice_number": "INV001"
  }
}
```

**After (recommended):**
```json
{
  "request_id": "inv_001",
  "phone_number": "6281234567890",
  "message": "https://example.com/invoice/123",
  "template_variables": {
    "recipient_name": "Budi",
    "message_type": "Berikut adalah tagihan baru untuk layanan internet Anda:",
    "invoice_number": "INV001",
    "grand_total": "250.000",
    "invoice_url": "https://example.com/invoice/123"
  }
}
```

**Benefits of `template_variables`:**
- Direct control over all template placeholders
- No automatic transformations (you format values yourself)
- Easier debugging (what you send is what gets used)
- Future-proof as templates change

---

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "No template linked" | API client has no template configured | Link a template in Admin > API Message |
| "Template not approved" | WhatsApp hasn't approved the template | Wait for approval or use different template |
| "Template not synced" | Template not synced to Twilio | Sync template in Templates page |
| "Template inactive" | Template is disabled | Activate template in Templates page |
| "Invalid signature" | Wrong signature format | Check signature uses dot separator |
| "Request timestamp expired" | Clock not synced | Sync system clock, use milliseconds |

### Signature Debugging

If you're getting "Invalid signature" errors:

1. Ensure timestamp is in **milliseconds** (not seconds)
2. Use **dot (.)** separator in payload: `clientId.timestamp.body`
3. Body must be exactly the same JSON sent in request
4. Secret key must match what's in Admin panel

---

## Support

For API access or issues, contact the OmniDesk administrator.
