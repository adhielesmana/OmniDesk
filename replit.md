# Unified Inbox Management App

## Overview

A multi-platform messaging inbox application that consolidates conversations from WhatsApp, Instagram, and Facebook into a single unified interface. The app enables users to view, manage, and respond to messages across all connected social platforms from one dashboard.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Real-time Updates**: WebSocket connection for live message updates

**Design Pattern**: The frontend follows a 3-column layout architecture inspired by Linear and Slack - platform sidebar, conversation list, and message thread view. Components are organized by feature (inbox components) and shared UI elements.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Style**: RESTful endpoints under `/api/*` prefix
- **Real-time**: WebSocket server (ws) for broadcasting message updates to connected clients
- **Build System**: esbuild for server bundling, Vite for client bundling

**Key Server Files**:
- `server/routes.ts` - API endpoint definitions and WebSocket setup
- `server/storage.ts` - Data access layer with storage interface
- `server/meta-api.ts` - Meta Graph API integration for WhatsApp/Instagram/Facebook

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Migrations**: Drizzle Kit for schema migrations (`drizzle-kit push`)

**Core Entities**:
- `contacts` - Customer/contact information with platform-specific IDs
- `conversations` - Message threads linked to contacts
- `messages` - Individual messages with direction, status, and media support
- `platformSettings` - API credentials and configuration per platform
- `quickReplies` - Saved quick reply templates

### API Integration
- **Meta Graph API**: Integration for WhatsApp Business API, Instagram Messaging, and Facebook Messenger
- **Webhook Support**: Endpoints for receiving inbound messages from Meta platforms
- **Message Status Tracking**: Sent, delivered, read, and failed states

## External Dependencies

### Third-Party Services
- **Meta Graph API (v21.0)**: Primary integration for all messaging platforms
  - WhatsApp Business API
  - Instagram Messaging API
  - Facebook Messenger API

### Database
- **PostgreSQL**: Primary database (connection via `DATABASE_URL` environment variable)
- **connect-pg-simple**: Session storage in PostgreSQL

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `@tanstack/react-query`: Server state management
- `ws`: WebSocket server implementation
- `date-fns`: Date formatting utilities
- `zod` / `drizzle-zod`: Schema validation
- Radix UI primitives: Accessible UI component foundations