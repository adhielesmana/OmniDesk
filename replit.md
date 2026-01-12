# Unified Inbox Management App

## Overview

A multi-platform messaging inbox application that consolidates conversations from WhatsApp, Instagram, and Facebook into a single unified interface. The app enables users to view, manage, and respond to messages across all connected social platforms from one dashboard.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

- **Docker Git Support**: Added git to Dockerfile for update functionality in production containers
- **Session Handling Fix**: Added explicit session.save() in login endpoint and error logging for session store
- **Deploy Script Improvements**: Added session table creation to deploy.sh, fixed nginx X-Forwarded-Proto for HTTPS
- **WhatsApp LID Handling**: Added `whatsappLid` field to contacts schema to store WhatsApp Linked IDs (15+ digit internal identifiers) separately from phone numbers. LIDs are WhatsApp-internal identifiers that don't correspond to real phone numbers - only WhatsApp knows the mapping. Migrated 254 existing LID-only contacts from phone_number to whatsapp_lid field.
- **Contact Lookup Enhancement**: Updated storage layer to search contacts by both phone_number and whatsapp_lid fields when processing incoming messages. Prevents duplicate contacts/conversations for LID-only contacts.
- **Authentication System**: Added user authentication with session management using express-session and PostgreSQL session store
- **User Roles**: Implemented superadmin, admin, and user roles with role-based access control
- **Department Management**: Added departments for organizing conversations and users
- **Superadmin Seeding**: Hardcoded superadmin (username: adhielesmana, password: admin123) created on startup, non-deletable
- **Admin Panel**: New admin page for managing users and departments
- **OpenAI API Key Management**: Added Settings modal tab for managing OpenAI API key with validation, save/delete functionality

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

## Known Issues

- **Profile Pictures**: WhatsApp profile picture URLs are temporary and expire. Users can click refresh button to update profile pictures, but they may become unavailable after some time.
