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