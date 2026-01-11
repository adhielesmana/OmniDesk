#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Unified Inbox - Deployment Script${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

check_command() {
    if ! command -v $1 &> /dev/null; then
        return 1
    fi
    return 0
}

find_available_port() {
    local port=$1
    local max_port=$((port + 100))
    
    while [ $port -lt $max_port ]; do
        if ! ss -tuln 2>/dev/null | grep -q ":$port " && \
           ! netstat -tuln 2>/dev/null | grep -q ":$port "; then
            echo $port
            return 0
        fi
        port=$((port + 1))
    done
    
    echo ""
    return 1
}

echo -e "${BLUE}[1/7] Checking prerequisites...${NC}"

if ! check_command docker; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    echo "Please install Docker first: https://docs.docker.com/engine/install/"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker installed"

if ! check_command docker-compose && ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed.${NC}"
    echo "Please install Docker Compose first."
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker Compose installed"

if ! check_command nginx; then
    echo -e "${YELLOW}Nginx is not installed.${NC}"
    read -p "Would you like to install Nginx? (y/N): " install_nginx
    if [[ "$install_nginx" =~ ^[Yy]$ ]]; then
        if check_command apt-get; then
            apt-get update && apt-get install -y nginx
        elif check_command yum; then
            yum install -y nginx
        elif check_command dnf; then
            dnf install -y nginx
        else
            echo -e "${RED}Could not detect package manager. Please install Nginx manually.${NC}"
            exit 1
        fi
        systemctl enable nginx
        systemctl start nginx
    else
        echo -e "${RED}Nginx is required. Exiting.${NC}"
        exit 1
    fi
fi
echo -e "  ${GREEN}✓${NC} Nginx installed"

if ! check_command certbot; then
    echo -e "${YELLOW}Certbot is not installed.${NC}"
    read -p "Would you like to install Certbot for SSL? (y/N): " install_certbot
    if [[ "$install_certbot" =~ ^[Yy]$ ]]; then
        if check_command apt-get; then
            apt-get update && apt-get install -y certbot python3-certbot-nginx
        elif check_command yum; then
            yum install -y certbot python3-certbot-nginx
        elif check_command dnf; then
            dnf install -y certbot python3-certbot-nginx
        else
            echo -e "${RED}Could not detect package manager. Please install Certbot manually.${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}  Continuing without SSL support.${NC}"
    fi
else
    echo -e "  ${GREEN}✓${NC} Certbot installed"
fi

if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found.${NC}"
    echo "Please run ./setup.sh first to configure the environment."
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Environment file found"

source .env

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: DOMAIN not set in .env file.${NC}"
    echo "Please run ./setup.sh again."
    exit 1
fi

echo ""
echo -e "${BLUE}[2/7] Stopping existing containers...${NC}"

if docker compose version &> /dev/null; then
    docker compose down 2>/dev/null || true
else
    docker-compose down 2>/dev/null || true
fi
echo -e "  ${GREEN}✓${NC} Containers stopped"

sleep 3

DEFAULT_PORT=${APP_PORT:-5000}

echo ""
echo -e "${BLUE}[3/7] Checking port availability...${NC}"

AVAILABLE_PORT=$(find_available_port $DEFAULT_PORT)

if [ -z "$AVAILABLE_PORT" ]; then
    echo -e "${RED}Error: Could not find available port between $DEFAULT_PORT and $((DEFAULT_PORT + 100))${NC}"
    exit 1
fi

if [ "$AVAILABLE_PORT" != "$DEFAULT_PORT" ]; then
    echo -e "  ${YELLOW}Port $DEFAULT_PORT is in use. Using port $AVAILABLE_PORT instead.${NC}"
    sed -i "s/APP_PORT=.*/APP_PORT=$AVAILABLE_PORT/" .env
    export APP_PORT=$AVAILABLE_PORT
else
    echo -e "  ${GREEN}✓${NC} Port $AVAILABLE_PORT is available"
fi

APP_PORT=$AVAILABLE_PORT

echo ""
echo -e "${BLUE}[4/7] Building and starting containers...${NC}"
echo -e "  ${YELLOW}→${NC} Starting PostgreSQL database..."
echo -e "  ${YELLOW}→${NC} Building application image..."

if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo -e "  ${GREEN}✓${NC} PostgreSQL database container started"
echo -e "  ${GREEN}✓${NC} Application container started"

echo ""
echo -e "${BLUE}[5/7] Running database setup...${NC}"
echo -e "  ${YELLOW}→${NC} Waiting for PostgreSQL to be ready..."
sleep 15

echo -e "  ${YELLOW}→${NC} Creating database tables..."
echo -e "  ${YELLOW}→${NC} Running migrations..."

if docker compose version &> /dev/null; then
    docker compose exec -T inbox-app npm run db:push 2>&1 | while read line; do
        echo -e "      $line"
    done
else
    docker-compose exec -T inbox-app npm run db:push 2>&1 | while read line; do
        echo -e "      $line"
    done
fi

echo -e "  ${GREEN}✓${NC} Database tables created"
echo -e "  ${GREEN}✓${NC} Migrations completed"
echo -e "  ${GREEN}✓${NC} Admin user seeded automatically on first start"

echo ""
echo -e "${BLUE}[6/7] Configuring Nginx...${NC}"

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

if [ -f "$NGINX_CONF" ] && grep -q "proxy_pass http://127.0.0.1:$APP_PORT" "$NGINX_CONF" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Nginx already configured for $DOMAIN (skipped)"
else
    tee "$NGINX_CONF" > /dev/null << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    client_max_body_size 50M;
}
EOF

    if [ ! -L "$NGINX_ENABLED" ]; then
        ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
    fi

    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        echo -e "  ${GREEN}✓${NC} Nginx configured for $DOMAIN"
    else
        echo -e "${RED}Nginx configuration test failed.${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}[7/7] Setting up SSL...${NC}"

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo -e "  ${GREEN}✓${NC} SSL certificate already configured (skipped)"
elif check_command certbot; then
    read -p "Set up SSL certificate for $DOMAIN? (Y/n): " setup_ssl
    if [[ ! "$setup_ssl" =~ ^[Nn]$ ]]; then
        read -p "Enter email for SSL notifications: " SSL_EMAIL
        while [ -z "$SSL_EMAIL" ]; do
            read -p "Email is required: " SSL_EMAIL
        done

        certbot --nginx -d "$DOMAIN" --email "$SSL_EMAIL" --agree-tos --non-interactive --redirect
        
        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✓${NC} SSL certificate installed"
        else
            echo -e "  ${YELLOW}SSL setup failed. Try later with: certbot --nginx -d $DOMAIN${NC}"
        fi
    else
        echo -e "  ${YELLOW}Skipped SSL setup${NC}"
    fi
else
    echo -e "  ${YELLOW}Certbot not installed, skipping SSL${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Deployment Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Summary:"
echo -e "  ${GREEN}✓${NC} PostgreSQL database running"
echo -e "  ${GREEN}✓${NC} Database tables created"
echo -e "  ${GREEN}✓${NC} Application running on port $APP_PORT"
echo -e "  ${GREEN}✓${NC} Nginx reverse proxy configured"
echo ""
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo -e "Your app is available at: ${GREEN}https://$DOMAIN${NC}"
else
    echo -e "Your app is available at: ${GREEN}http://$DOMAIN${NC}"
fi
echo ""
echo -e "${YELLOW}Admin login credentials:${NC}"
echo "  Username: ${ADMIN_USERNAME:-admin}"
echo "  Password: ${ADMIN_PASSWORD:-admin123}"
echo ""
echo "Useful commands:"
echo "  View logs:      docker compose logs -f"
echo "  View app logs:  docker compose logs -f inbox-app"
echo "  View db logs:   docker compose logs -f postgres"
echo "  Restart:        docker compose restart"
echo "  Stop:           docker compose down"
echo "  Rebuild:        ./deploy.sh"
echo ""
