#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   OmniDesk - Update Script${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found.${NC}"
    echo "Please run ./setup.sh first to configure the environment."
    exit 1
fi

source .env

echo -e "${BLUE}[1/4] Pulling latest code from GitHub...${NC}"
git pull origin main || git pull origin master || echo -e "${YELLOW}Git pull failed or no changes${NC}"
echo -e "  ${GREEN}✓${NC} Code updated"

echo ""
echo -e "${BLUE}[2/4] Backing up WhatsApp session...${NC}"
if [ -d "whatsapp_auth" ]; then
    cp -r whatsapp_auth whatsapp_auth_backup 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} WhatsApp session backed up"
else
    echo -e "  ${YELLOW}No WhatsApp session to backup${NC}"
fi

echo ""
echo -e "${BLUE}[3/4] Rebuilding and updating containers (preserving data)...${NC}"
echo -e "  ${YELLOW}→${NC} This will update the app without losing WhatsApp connection..."

if docker compose version &> /dev/null; then
    docker compose build inbox-app
    docker compose up -d inbox-app
else
    docker-compose build inbox-app
    docker-compose up -d inbox-app
fi

echo -e "  ${GREEN}✓${NC} Application container updated"

if [ -d "whatsapp_auth_backup" ]; then
    if [ ! -d "whatsapp_auth" ] || [ -z "$(ls -A whatsapp_auth 2>/dev/null)" ]; then
        cp -r whatsapp_auth_backup/* whatsapp_auth/ 2>/dev/null || true
        echo -e "  ${GREEN}✓${NC} WhatsApp session restored from backup"
    fi
    rm -rf whatsapp_auth_backup 2>/dev/null || true
fi

echo ""
echo -e "${BLUE}[4/4] Running database migrations...${NC}"
sleep 5

if docker compose version &> /dev/null; then
    docker compose exec -T inbox-app npm run db:push 2>&1 | tail -5
else
    docker-compose exec -T inbox-app npm run db:push 2>&1 | tail -5
fi
echo -e "  ${GREEN}✓${NC} Database migrations complete"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Update Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Your app has been updated without losing the WhatsApp connection."
echo ""
echo "If WhatsApp still disconnected, run:"
echo "  docker compose logs -f inbox-app"
echo ""
echo "To check WhatsApp session:"
echo "  ls -la whatsapp_auth/"
echo ""
