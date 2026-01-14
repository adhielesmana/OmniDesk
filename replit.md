# OmniDesk - Unified Messaging Platform

## Overview

A multi-platform messaging inbox application that consolidates conversations from WhatsApp, Instagram, and Facebook into a single unified interface. The app enables users to view, manage, and respond to messages across all connected social platforms from one dashboard.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Twilio WhatsApp Integration**: Added official WhatsApp Business API support via Twilio. When Twilio is configured (via Replit Integrations), it becomes the primary method for sending WhatsApp messages. Falls back to Baileys (unofficial) if Twilio is not available. Features include:
  - Secure credential management via Replit's Twilio connector
  - Webhook endpoint at `/api/twilio/webhook` for incoming messages
  - Status callback at `/api/twilio/status` for delivery updates
  - Settings modal shows Twilio connection status and phone number
  - SMS sending capability via `/api/twilio/sms/send` endpoint
- **Typing Performance Fix**: Optimized message composer to prevent lag when typing. Used React.memo on MessageComposer, memoized send handlers with useCallback, and memoized message list calculations with useMemo.
- **Browser Cache for Conversations**: Added localStorage-based caching for conversations. Previously opened conversations load instantly from cache while fetching updates in background. Cache stores up to 50 conversations with 24-hour expiry. Automatically cleans up old entries to prevent storage bloat.
- **Message Pagination Performance Fix**: Fixed slow conversation loading by implementing cursor-based pagination. Conversations now load only the 100 most recent messages initially, with a "Load older messages" button to fetch earlier messages on demand. Uses (timestamp, id) pair for deterministic cursor to avoid skipping messages. Frontend dedupes messages to prevent duplicates when queries refresh.
- **Production Update Fix**: Fixed "Run Update" feature for Docker containers that don't have a .git directory. Now automatically initializes git repository if missing and handles fresh installations. Also cleans up legacy `.whatsapp-auth` files that conflict with git checkout (session data is now stored in database).
- **API Message Queue View**: Added "API Queue" tab in Admin panel showing all queued external API messages with status filters (Queued, Processing, Sending, Sent, Failed), message details, and ability to cancel/delete queued or failed messages. Auto-refreshes every 10 seconds.
- **Blast Campaign Prompt Editing**: Added ability to edit AI prompts for existing blast campaigns via dialog in campaign detail view.
- **WhatsApp Ban Prevention Improvements**: Comprehensive anti-ban protections:
  - Conservative rate limits: 10 messages/minute, 100/hour, 500/day (Jakarta timezone)
  - Per-contact spacing: 5 second minimum between messages to same contact
  - Session fingerprint randomization: Browser type and version randomized per session
  - Reconnection protection: Max 10 attempts with jittered exponential backoff (5s-120s)
  - Quiet hours for auto-reply: 9PM-7AM Jakarta time
  - Blast campaigns: 10-30 minute randomized intervals between sends
- **Database-Backed WhatsApp Session**: WhatsApp authentication state is now stored in the PostgreSQL database (`whatsapp_auth_state` table) instead of filesystem. This allows sessions to persist across server restarts, backups, and deployments. Users can reconnect by clicking the login button without scanning the QR code again.
- **Blast Message Time Restriction**: Blast campaigns now only send messages between 7 AM and 9 PM to avoid midnight blasting and reduce WhatsApp detection risk
- **Auto-Reply Feature**: New auto-reply system that automatically responds to conversations inactive for more than 24 hours, treating them as new conversations. Configurable via Settings modal with enable/disable toggle and customizable AI prompt. Disabled when no prompt is saved.
- **Blast Message Pre-Generation**: All blast campaign messages are now pre-generated immediately after campaign creation with progress tracking (generatedCount, isGenerating fields)
- **Docker Git Support**: Added git to Dockerfile for update functionality in production containers
- **Session Handling Fix**: Added explicit session.save() in login endpoint and error logging for session store
- **Deploy Script Improvements**: Added session table creation to deploy.sh, fixed nginx X-Forwarded-Proto for HTTPS
- **WhatsApp LID Handling**: Added `whatsappLid` field to contacts schema to store WhatsApp Linked IDs (15+ digit internal identifiers) separately from phone numbers. LIDs are WhatsApp-internal identifiers that don't correspond to real phone numbers - only WhatsApp knows the mapping. Migrated 254 existing LID-only contacts from phone_number to whatsapp_lid field.
- **WhatsApp Contact Matching & Auto-Merge**: Enhanced contact resolution to prevent duplicate conversations. When an incoming message has both a LID and phone number (from Baileys metadata), the system searches for contacts by both identifiers. If two separate contacts are found (one matched by LID, one by phone), they're automatically merged: conversations are moved to the primary contact, identifiers are combined, and the duplicate is deleted. This prevents the issue where the same person appears twice when WhatsApp switches between using their LID and phone number.
- **Authentication System**: Added user authentication with session management using express-session and PostgreSQL session store
- **User Roles**: Implemented superadmin, admin, and user roles with role-based access control
- **Department Management**: Added departments for organizing conversations and users
- **Superadmin Seeding**: Hardcoded superadmin (username: adhielesmana, password: admin123) created on startup, non-deletable
- **Admin Panel**: New admin page for managing users and departments
- **OpenAI API Key Management**: Added Settings modal tab for managing OpenAI API key with validation, save/delete functionality
- **External API for WhatsApp Messaging**: Secure API for external applications to send WhatsApp messages through OmniDesk. Features include:
  - HMAC-SHA256 authentication with AES-256-GCM encrypted secrets
  - Per-minute sliding window rate limiting with X-RateLimit headers
  - Daily quota enforcement with automatic reset
  - IP whitelisting supporting Cloudflare's CF-Connecting-IP header
  - Message queue with 2-3 minute throttling and 7AM-9PM Jakarta time restrictions
  - Request ID deduplication to prevent duplicate sends
  - Full admin UI for API client management in Admin panel
- **URL Shortening for API Messages**: All URLs in API messages are automatically shortened to prevent WhatsApp detection/blocking. Uses JavaScript-based redirect (not HTTP 301) so WhatsApp's link preview cannot see the final domain. Short URLs use `/s/{code}` format and track click counts. URLs are stored in `shortened_urls` table.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Real-time Updates**: WebSocket connection for live message updates
- **Authentication**: Protected routes with login page, auth context hook

**Design Pattern**: The frontend follows a 3-column layout architecture inspired by Linear and Slack - platform sidebar, conversation list, and message thread view. Components are organized by feature (inbox components) and shared UI elements.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Style**: RESTful endpoints under `/api/*` prefix
- **Real-time**: WebSocket server (ws) for broadcasting message updates to connected clients
- **Authentication**: express-session with PostgreSQL session store, bcrypt password hashing
- **Build System**: esbuild for server bundling, Vite for client bundling

**Key Server Files**:
- `server/routes.ts` - API endpoint definitions and WebSocket setup
- `server/storage.ts` - Data access layer with storage interface
- `server/auth.ts` - Authentication helpers, password hashing, superadmin seeding
- `server/meta-api.ts` - Meta Graph API integration for WhatsApp/Instagram/Facebook
- `server/whatsapp.ts` - Unofficial WhatsApp integration using Baileys library
- `server/twilio.ts` - Official Twilio WhatsApp/SMS integration
- `server/blast-worker.ts` - Background worker for blast message campaigns with time-of-day restrictions
- `server/autoreply.ts` - Auto-reply system for conversations inactive > 24 hours
- `server/external-api.ts` - External API for third-party WhatsApp messaging with HMAC auth

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Migrations**: Drizzle Kit for schema migrations (`drizzle-kit push`)

**Core Entities**:
- `users` - System users with roles (superadmin, admin, user) and authentication
- `departments` - Organizational units for conversation assignment
- `user_departments` - Many-to-many relationship between users and departments
- `contacts` - Customer/contact information with platform-specific IDs
- `conversations` - Message threads linked to contacts and optionally departments
- `messages` - Individual messages with direction, status, and media support
- `platformSettings` - API credentials and configuration per platform
- `quickReplies` - Saved quick reply templates
- `appSettings` - Application-wide settings including OpenAI API key with validation status
- `whatsappAuthState` - Database-backed WhatsApp authentication credentials for session persistence
- `apiClients` - External API clients with HMAC credentials, rate limits, and IP whitelist
- `apiMessageQueue` - Queue for external API messages awaiting delivery
- `apiRequestLogs` - Audit logs for external API requests
- `shortened_urls` - URL shortening for API messages to prevent WhatsApp blocking

**Key Server Files**:
- `server/whatsapp-db-auth.ts` - Database-backed authentication state for Baileys library

### Authentication & Authorization
- **Session Management**: PostgreSQL-backed session store with 24-hour expiry
- **Password Security**: bcrypt with 12 salt rounds
- **Role Hierarchy**:
  - Superadmin: Full access, cannot be deleted, sees all departments
  - Admin: User/department management, same privileges as superadmin
  - User: Limited to assigned departments only

### API Integration
- **Unofficial WhatsApp (Baileys)**: Primary WhatsApp integration with QR code auth
- **Meta Graph API**: Integration for Instagram and Facebook Messenger
- **Webhook Support**: Endpoints for receiving inbound messages from Meta platforms
- **Message Status Tracking**: Sent, delivered, read, and failed states

## External Dependencies

### Third-Party Services
- **Baileys Library**: Unofficial WhatsApp Web API
- **Meta Graph API (v21.0)**: For Instagram/Facebook platforms
  - Instagram Messaging API
  - Facebook Messenger API

### Database
- **PostgreSQL**: Primary database (connection via `DATABASE_URL` environment variable)
- **connect-pg-simple**: Session storage in PostgreSQL

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `@tanstack/react-query`: Server state management
- `@whiskeysockets/baileys`: Unofficial WhatsApp library
- `express-session` / `connect-pg-simple`: Session management
- `bcrypt`: Password hashing
- `ws`: WebSocket server implementation
- `date-fns`: Date formatting utilities
- `zod` / `drizzle-zod`: Schema validation
- Radix UI primitives: Accessible UI component foundations

## Maintenance Notes

### Baileys WhatsApp Library Updates
- **Keep Updated**: The Baileys library (@whiskeysockets/baileys) must be kept up-to-date as WhatsApp frequently updates their protocol. Outdated versions may stop working.
- **Update Command**: Run `npm update @whiskeysockets/baileys` or use Admin panel "Run Update" for production
- **Session Persistence**: WhatsApp authentication is stored in the database (whatsapp_auth_state table), so sessions survive library updates without needing to re-scan QR code
- **Update Best Practices**:
  - Schedule updates during low-traffic periods
  - Pause blast campaigns before updating
  - Verify WhatsApp connection after update
  - Check server logs for any protocol warnings

## Known Issues

- **Profile Pictures**: WhatsApp profile picture URLs are temporary and expire. Users can click refresh button to update profile pictures, but they may become unavailable after some time.
