#!/bin/bash

set -e

echo "============================================"
echo "   Unified Inbox - Quick Setup"
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

read -p "Enter your domain name (e.g., inbox.yourdomain.com): " DOMAIN
while [ -z "$DOMAIN" ]; do
    read -p "Domain is required: " DOMAIN
done

read -p "OpenAI API Key (optional, press Enter to skip): " OPENAI_KEY

DB_NAME="unified_inbox"
DB_USER="inbox_user"
DB_PASS=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_USER="admin"
ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=')
APP_PORT=5000

echo ""
echo "Auto-generating secure credentials..."

cat > "$ENV_FILE" << EOF
# Domain Configuration
DOMAIN=$DOMAIN
APP_PORT=$APP_PORT

# Database Configuration (auto-generated)
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@postgres:5432/$DB_NAME

# Session Security (auto-generated)
SESSION_SECRET=$SESSION_SECRET

# Admin Credentials (auto-generated)
ADMIN_USERNAME=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASS

# OpenAI Integration (optional)
OPENAI_API_KEY=$OPENAI_KEY
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "============================================"
echo "   Configuration Complete!"
echo "============================================"
echo ""
echo "Generated credentials (saved to .env):"
echo "  Database:       $DB_NAME"
echo "  DB User:        $DB_USER"
echo "  DB Pass:        $DB_PASS"
echo ""
echo "  Admin Username: $ADMIN_USER"
echo "  Admin Password: $ADMIN_PASS"
echo ""
echo "IMPORTANT: Save these credentials somewhere safe!"
echo ""
echo "Next step: Run ./deploy.sh"
echo ""
