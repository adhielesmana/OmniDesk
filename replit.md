# OmniDesk - Unified Messaging Platform

## Overview

OmniDesk is a multi-platform messaging inbox application designed to consolidate conversations from WhatsApp, Instagram, and Facebook into a single, unified interface. It allows users to view, manage, and respond to messages across all connected social platforms from one centralized dashboard. The project aims to streamline communication for businesses and individuals, enhancing efficiency and customer engagement. Key capabilities include managing contacts, conducting blast campaigns, utilizing an auto-reply system, and integrating with external APIs for extended functionality.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite.
- **Routing**: Wouter.
- **State Management**: TanStack React Query for server state and caching.
- **UI Components**: shadcn/ui built on Radix UI primitives.
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode).
- **Real-time Updates**: WebSocket connection.
- **Authentication**: Protected routes with login page and auth context hook.
- **Design Pattern**: 3-column layout (platform sidebar, conversation list, message thread view).
- **Performance**: Conversation list virtualization (30 initial conversations, lazy-loaded on scroll) and optimized message composer to prevent typing lag.

### Backend Architecture
- **Framework**: Express.js with TypeScript.
- **API Style**: RESTful endpoints (`/api/*`).
- **Real-time**: WebSocket server (`ws`) for broadcasting message updates.
- **Authentication**: `express-session` with PostgreSQL session store, `bcrypt` for password hashing.
- **Build System**: `esbuild` for server bundling.
- **Core Features**: Integrations for Meta Graph API, unofficial WhatsApp (Baileys), official Twilio WhatsApp/SMS, blast message campaigns, auto-reply system, and an external API for third-party WhatsApp messaging with HMAC authentication.
- **Anti-Ban Protections**: Includes conservative rate limits, per-contact message spacing, session fingerprint randomization, reconnection protection, and quiet hours for auto-replies and blast campaigns to prevent WhatsApp bans.
- **Security**: HMAC-SHA256 authentication with AES-256-GCM encrypted secrets for external API, rate limiting, daily quota enforcement, IP whitelisting, and request ID deduplication.
- **URL Shortening**: Automatic URL shortening for API messages with JavaScript-based redirects and click tracking to prevent WhatsApp blocking.

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema**: `shared/schema.ts` (shared between client and server).
- **Migrations**: Drizzle Kit.
- **Core Entities**:
    - `users`: With roles (superadmin, admin, user).
    - `departments`: For conversation organization.
    - `contacts`: Customer/contact information, supporting WhatsApp LIDs and auto-merging duplicate contacts.
    - `conversations`: Message threads.
    - `messages`: Individual messages with media support.
    - `platformSettings`: API credentials per platform.
    - `quickReplies`: Saved templates.
    - `appSettings`: Application-wide settings including OpenAI API key.
    - `whatsappAuthState`: Database-backed WhatsApp authentication state for session persistence.
    - `apiClients`: External API clients with credentials and rate limits.
    - `apiMessageQueue`: Queue for external API messages.
    - `apiRequestLogs`: Audit logs for external API requests.
    - `shortened_urls`: For tracking shortened URLs.

### Authentication & Authorization
- **Session Management**: PostgreSQL-backed session store with 24-hour expiry.
- **Password Security**: bcrypt with 12 salt rounds.
- **Role Hierarchy**: Superadmin (full access), Admin (user/department management), User (department-limited access).

### API Integration
- **Unofficial WhatsApp (Baileys)**: Primary WhatsApp integration with QR code authentication.
- **Meta Graph API**: For Instagram and Facebook Messenger.
- **Webhook Support**: For inbound messages from Meta platforms.
- **Message Status Tracking**: Sent, delivered, read, and failed states.

## External Dependencies

### S3 Storage
- **S3-Compatible Storage**: Supports any S3-compatible storage provider for persistent media storage across deployments.
- **Media Storage**: Incoming WhatsApp, Instagram, and Facebook message media automatically uploaded to S3.
- **Folder Structure**: `whatsapp-media/`, `instagram-media/`, `facebook-media/`, `branding/`
- **Local Fallback**: Gracefully falls back to local storage if S3 not configured.
- **Settings Storage**: S3 credentials stored in `app_settings` table (s3_endpoint, s3_bucket, s3_region, s3_access_key_id, s3_secret_access_key, s3_use_path_style).

### Third-Party Services
- **Baileys Library**: Unofficial WhatsApp Web API.
- **Meta Graph API (v21.0)**: For Instagram and Facebook platforms (Instagram Messaging API, Facebook Messenger API).
- **Twilio**: Official WhatsApp Business API and SMS gateway.
- **S3 Storage**: S3-compatible storage (configured with is3.cloudhost.id).

### Database
- **PostgreSQL**: Primary data store.
- **connect-pg-simple**: For PostgreSQL session storage.

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: ORM and migrations.
- `@tanstack/react-query`: Server state management.
- `@whiskeysockets/baileys`: Unofficial WhatsApp library.
- `express-session` / `connect-pg-simple`: Session management.
- `bcrypt`: Password hashing.
- `ws`: WebSocket server.
- `date-fns`: Date utilities.
- `zod` / `drizzle-zod`: Schema validation.
- Radix UI primitives: Accessible UI components.

---

## Multi-Tenant Upgrade Plan (For Forked Project)

> **Note**: This section documents the architecture for a multi-tenant version of OmniDesk. The current single-tenant version should remain unchanged. Fork this project and implement these changes in the new project.

### Goal
Create a multi-tenant OmniDesk where multiple companies/departments can use a single deployment, each with their own:
- WhatsApp accounts (Baileys and/or Twilio)
- Instagram accounts
- Facebook pages
- Isolated contacts, conversations, and messages

### Database Schema Changes

#### New Tables

```typescript
// Tenants (companies/organizations)
tenants: {
  id: uuid primaryKey,
  name: text notNull,
  slug: text unique notNull, // URL-friendly identifier
  isActive: boolean default true,
  createdAt: timestamp,
  updatedAt: timestamp,
}

// Tenant Platform Accounts (multiple per tenant)
tenantPlatformAccounts: {
  id: uuid primaryKey,
  tenantId: uuid references tenants(id),
  platform: text notNull, // 'whatsapp_baileys', 'whatsapp_twilio', 'instagram', 'facebook'
  accountName: text notNull, // Display name
  phoneNumber: text, // For WhatsApp
  accountId: text, // IG/FB account ID
  accessToken: text, // Encrypted
  isActive: boolean default true,
  isPrimary: boolean default false, // Primary account for this platform
  createdAt: timestamp,
}

// Baileys sessions per tenant account
tenantWhatsappAuthState: {
  id: uuid primaryKey,
  tenantPlatformAccountId: uuid references tenantPlatformAccounts(id),
  creds: text,
  keys: jsonb,
  lastConnected: timestamp,
}
```

#### Modified Tables

```typescript
// Add tenantId to existing tables:
users: { ...existing, tenantId: uuid references tenants(id) }
departments: { ...existing, tenantId: uuid references tenants(id) }
contacts: { ...existing, tenantId: uuid references tenants(id) }
conversations: { 
  ...existing, 
  tenantId: uuid references tenants(id),
  platformAccountId: uuid references tenantPlatformAccounts(id) // Which account this conversation belongs to
}
messages: { ...existing } // No change needed, linked via conversation
quickReplies: { ...existing, tenantId: uuid references tenants(id) }
blastCampaigns: { ...existing, tenantId: uuid references tenants(id) }
autoReplyRules: { ...existing, tenantId: uuid references tenants(id) }
apiClients: { ...existing, tenantId: uuid references tenants(id) }
```

### User Roles (Extended)

| Role | Scope | Permissions |
|------|-------|-------------|
| **superadmin** | Global | Manage all tenants, create tenants, view all data |
| **tenant_admin** | Tenant | Full control within their tenant, manage users/accounts |
| **admin** | Tenant | User/department management within tenant |
| **user** | Tenant/Department | Limited to assigned departments within tenant |

### Backend Changes

#### Session Management
- Store `tenantId` in session alongside `userId`
- All queries filter by `tenantId` from session
- Superadmin can switch between tenants

#### WhatsApp (Baileys) Multi-Session
- Each tenant platform account needs its own Baileys socket
- Store in a Map: `Map<accountId, BaileysSocket>`
- Connect/disconnect accounts independently
- QR code generation per account

#### Webhook Routing
- **Twilio**: Route by `To` phone number → lookup `tenantPlatformAccounts`
- **Meta (IG/FB)**: Route by `recipient.id` → lookup `tenantPlatformAccounts`
- **Baileys**: Each socket knows its account ID

#### API Routes Changes
- All `/api/*` routes filter by session's `tenantId`
- New routes: `/api/tenants/*` for superadmin
- New routes: `/api/tenant/accounts/*` for managing platform accounts

### Frontend Changes

#### New Pages
- `/tenants` - Superadmin tenant management
- `/tenant/accounts` - Tenant admin platform account management
- `/tenant/settings` - Tenant-specific settings

#### UI Modifications
- Account selector in message composer (choose which WhatsApp/IG/FB to send from)
- Tenant switcher for superadmin in header
- Account indicator on conversations showing which account received the message

### Migration Strategy

1. **Create new tables** (tenants, tenantPlatformAccounts, tenantWhatsappAuthState)
2. **Create default tenant** for existing data
3. **Migrate existing platformSettings** to tenantPlatformAccounts
4. **Add tenantId columns** with default tenant ID
5. **Update all queries** to filter by tenantId
6. **Build new UI components**
7. **Test thoroughly** before deploying

### Key Files to Modify

| File | Changes |
|------|---------|
| `shared/schema.ts` | Add new tables, modify existing with tenantId |
| `server/storage.ts` | Add tenantId filtering to all methods |
| `server/routes.ts` | Add tenant context, new tenant routes |
| `server/whatsapp.ts` | Multi-socket management |
| `server/twilio.ts` | Multi-account routing |
| `server/meta-api.ts` | Multi-account routing |
| `server/webhooks.ts` | Route by account lookup |
| `client/src/App.tsx` | Tenant context provider |
| `client/src/pages/inbox.tsx` | Account selector |
| `client/src/components/` | Account indicators |

### Production Considerations

- **Memory**: Multiple Baileys sessions use more RAM
- **Rate Limits**: Track per-account, not global
- **Billing**: Consider per-tenant usage tracking
- **Isolation**: Ensure no data leakage between tenants
- **Onboarding**: Tenant creation wizard with account setup

### Estimated Effort

| Phase | Tasks | Estimate |
|-------|-------|----------|
| 1. Database | Schema, migrations | 2-3 days |
| 2. Backend | Storage, routes, auth | 4-5 days |
| 3. Multi-Session | Baileys, webhooks | 3-4 days |
| 4. Frontend | UI components, pages | 3-4 days |
| 5. Testing | Integration, edge cases | 2-3 days |
| **Total** | | **2-3 weeks** |

---

## Current Single-Tenant Configuration Reference

### S3 Storage
- **Endpoint**: https://is3.cloudhost.id
- **Bucket**: apjii-mitradc
- **Region**: SouthJkt-a

### Business Phone
- **Twilio Number**: +628991306262 (stored in app_settings.twilio_phone_number)

### Production API Client
- **Client ID**: odk_91c7fd562dd1d6d691a0abbe
- **Webhook receives**: Numbered metadata (1-10) mapping to {{1}}-{{10}} placeholders

### Timezone
- **Default**: Asia/Jakarta (GMT+7)
- **Quiet Hours**: Configured in app_settings for auto-reply and blast campaigns