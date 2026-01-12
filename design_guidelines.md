# OmniDesk - Design Guidelines

## Design Approach

**Selected Framework:** Design System Approach - Hybrid inspiration from Linear (clean, modern productivity) + Slack (conversation management) + Material Design (information density)

**Rationale:** This is a utility-focused dashboard requiring efficient message management across multiple platforms. Clarity, scanability, and functional hierarchy are paramount.

## Typography System

**Font Stack:** Inter (primary) via Google Fonts CDN
- Headers: font-semibold to font-bold, text-xl to text-3xl
- Body/Messages: font-normal, text-sm to text-base
- Metadata (timestamps, status): font-medium, text-xs to text-sm
- Message input: font-normal, text-base

## Layout Architecture

**Primary Structure:** 3-column layout
1. **Left Sidebar (w-64):** Platform switcher + account navigation
2. **Middle Panel (w-80 to w-96):** Conversation list/inbox
3. **Main Content (flex-1):** Active conversation thread + message composer

**Spacing System:** Tailwind units of 2, 3, 4, 6, 8
- Component padding: p-4, p-6
- Section gaps: space-y-2, space-y-4
- Content margins: mb-4, mb-6, mt-8

**Responsive Behavior:**
- Mobile: Stack vertically, show one panel at a time with back navigation
- Tablet: 2-column (inbox + conversation)
- Desktop: Full 3-column layout

## Core Components

### Navigation & Structure
- **Top Bar (h-14):** Account selector, search, notifications, settings icon
- **Platform Sidebar:** Vertical tabs for WhatsApp/Instagram/Facebook with badge counters
- **Conversation List:** Scrollable list with avatar, name, last message preview, timestamp, unread indicator
- **Message Thread:** Chronological messages with sender avatar, bubble layout (sent vs received alignment)

### Message Components
- **Message Bubbles:** Rounded corners (rounded-2xl), max-width constraints (max-w-2xl), padding p-3 to p-4
- **Media Attachments:** Image previews, file cards with icons, link previews
- **Message Composer:** Sticky bottom (sticky bottom-0), textarea with auto-expand, attachment button, emoji picker, send button
- **Quick Replies:** Pill-style suggestion chips above composer

### Data Display
- **Conversation Cards:** Include platform icon, customer name/number, last message snippet (truncate), timestamp, unread count badge
- **Contact Info Panel (collapsible):** Customer details, tags, notes, conversation history stats
- **Status Indicators:** Delivered/read receipts, typing indicators, online status dots

### Interactive Elements
- **Search Bar:** Full-width in top bar, with filters dropdown (by platform, date, status)
- **Action Buttons:** Icon + text for primary actions (Archive, Mark as Read, Assign), icon-only for secondary
- **Filters/Tags:** Chip-based filtering system for organizing conversations

### Forms & Inputs
- **Message Input:** Multi-line textarea with h-auto min-h-[80px] max-h-[200px]
- **Customer Detail Forms:** Standard form fields with labels, validation states
- **Settings Panels:** Grouped form sections with clear headings

## Component Hierarchy

**Priority Levels:**
1. Active conversation (largest, most prominent)
2. Conversation list (medium density, scannable)
3. Sidebar navigation (compact, always accessible)
4. Secondary panels (collapsible/toggleable)

## Images

**Platform Icons:** Use official brand icons for WhatsApp, Instagram, Facebook via CDN or SVG
**User Avatars:** Circular (rounded-full), sizes: 8 (list), 10 (conversation), 12 (details)
**Media Previews:** Max-height constraints, clickable to expand in modal

**No Hero Image:** This is a dashboard application, not a marketing page

## Iconography

**Library:** Heroicons (outline for navigation, solid for actions)
- Navigation: ChatBubbleLeftRightIcon, InboxIcon, Cog6ToothIcon
- Actions: PaperAirplaneIcon, PaperClipIcon, EllipsisVerticalIcon
- Status: CheckIcon, CheckCheckIcon, ClockIcon

## Interaction Patterns

- **Conversation Selection:** Click to load in main panel, highlight active conversation
- **Real-time Updates:** New messages appear with subtle slide-in animation (duration-200)
- **Infinite Scroll:** Load more conversations/messages on scroll
- **Keyboard Shortcuts:** Enter to send, Cmd+K for search, arrow keys for navigation
- **Drag & Drop:** File attachments into composer

## Accessibility

- Semantic HTML: <nav>, <aside>, <main>, <article> for layout
- ARIA labels for icon-only buttons
- Keyboard navigation for all interactive elements
- Focus indicators: ring-2 ring-offset-2
- Alt text for all images/avatars

## Performance Considerations

- Virtual scrolling for long conversation lists
- Lazy load message history
- Optimize image delivery with thumbnails
- Debounced search input

This design creates a professional, efficient workspace for managing multi-platform customer communications with emphasis on clarity, speed, and information hierarchy.