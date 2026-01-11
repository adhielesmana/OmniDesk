#!/bin/bash

set -e

echo "============================================"
echo "   Unified Inbox - Environment Setup"
echo "============================================"
echo ""

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    read -p ".env file already exists. Overwrite? (y/N): " overwrite
    if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
fi

echo "Please provide the following configuration:"
echo ""

read -p "Domain name (e.g., inbox.yourdomain.com): " DOMAIN
while [ -z "$DOMAIN" ]; do
    read -p "Domain is required. Enter domain name: " DOMAIN
done

read -p "PostgreSQL Host (default: host.docker.internal): " DB_HOST
DB_HOST=${DB_HOST:-host.docker.internal}

read -p "PostgreSQL Port (default: 5432): " DB_PORT
DB_PORT=${DB_PORT:-5432}

read -p "PostgreSQL Database name (default: unified_inbox): " DB_NAME
DB_NAME=${DB_NAME:-unified_inbox}

read -p "PostgreSQL Username: " DB_USER
while [ -z "$DB_USER" ]; do
    read -p "Username is required: " DB_USER
done

read -sp "PostgreSQL Password: " DB_PASS
echo ""
while [ -z "$DB_PASS" ]; do
    read -sp "Password is required: " DB_PASS
    echo ""
done

SESSION_SECRET=$(openssl rand -hex 32)
echo "Generated SESSION_SECRET automatically."

read -p "OpenAI API Key (optional, press Enter to skip): " OPENAI_KEY

read -p "App Port (default: 5000): " APP_PORT
APP_PORT=${APP_PORT:-5000}

cat > "$ENV_FILE" << EOF
# Domain Configuration
DOMAIN=$DOMAIN
APP_PORT=$APP_PORT

# Database Configuration
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME

# Session Security
SESSION_SECRET=$SESSION_SECRET

# OpenAI Integration (optional)
OPENAI_API_KEY=$OPENAI_KEY
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "============================================"
echo "   Configuration saved to .env"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Make sure PostgreSQL is accessible"
echo "  2. Run: ./deploy.sh"
echo ""
