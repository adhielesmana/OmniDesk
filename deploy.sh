#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

if ! check_command docker; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    echo "Please install Docker first: https://docs.docker.com/engine/install/"
    exit 1
fi

if ! check_command docker-compose && ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed.${NC}"
    echo "Please install Docker Compose first."
    exit 1
fi

if ! check_command nginx; then
    echo -e "${YELLOW}Nginx is not installed.${NC}"
    read -p "Would you like to install Nginx? (y/N): " install_nginx
    if [[ "$install_nginx" =~ ^[Yy]$ ]]; then
        if check_command apt-get; then
            sudo apt-get update && sudo apt-get install -y nginx
        elif check_command yum; then
            sudo yum install -y nginx
        elif check_command dnf; then
            sudo dnf install -y nginx
        else
            echo -e "${RED}Could not detect package manager. Please install Nginx manually.${NC}"
            exit 1
        fi
        sudo systemctl enable nginx
        sudo systemctl start nginx
        echo -e "${GREEN}Nginx installed successfully.${NC}"
    else
        echo -e "${RED}Nginx is required. Exiting.${NC}"
        exit 1
    fi
fi

if ! check_command certbot; then
    echo -e "${YELLOW}Certbot is not installed.${NC}"
    read -p "Would you like to install Certbot for SSL? (y/N): " install_certbot
    if [[ "$install_certbot" =~ ^[Yy]$ ]]; then
        if check_command apt-get; then
            sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx
        elif check_command yum; then
            sudo yum install -y certbot python3-certbot-nginx
        elif check_command dnf; then
            sudo dnf install -y certbot python3-certbot-nginx
        else
            echo -e "${RED}Could not detect package manager. Please install Certbot manually.${NC}"
            exit 1
        fi
        echo -e "${GREEN}Certbot installed successfully.${NC}"
    else
        echo -e "${YELLOW}Continuing without SSL support.${NC}"
    fi
fi

if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found.${NC}"
    echo "Please run ./setup.sh first to configure the environment."
    exit 1
fi

source .env

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: DOMAIN not set in .env file.${NC}"
    echo "Please run ./setup.sh again."
    exit 1
fi

APP_PORT=${APP_PORT:-5000}

echo ""
echo -e "${GREEN}Building and starting Docker containers...${NC}"

if docker compose version &> /dev/null; then
    docker compose down 2>/dev/null || true
    docker compose up -d --build
else
    docker-compose down 2>/dev/null || true
    docker-compose up -d --build
fi

echo -e "${GREEN}Waiting for database to be ready...${NC}"
sleep 10

echo -e "${GREEN}Docker containers started.${NC}"

echo ""
echo -e "${GREEN}Configuring Nginx...${NC}"

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

sudo tee "$NGINX_CONF" > /dev/null << EOF
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
    sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
fi

sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

if sudo nginx -t; then
    sudo systemctl reload nginx
    echo -e "${GREEN}Nginx configured successfully.${NC}"
else
    echo -e "${RED}Nginx configuration test failed.${NC}"
    exit 1
fi

if check_command certbot; then
    echo ""
    read -p "Set up SSL certificate for $DOMAIN? (Y/n): " setup_ssl
    if [[ ! "$setup_ssl" =~ ^[Nn]$ ]]; then
        echo -e "${GREEN}Setting up SSL certificate...${NC}"
        
        read -p "Enter email for SSL notifications: " SSL_EMAIL
        while [ -z "$SSL_EMAIL" ]; do
            read -p "Email is required: " SSL_EMAIL
        done

        sudo certbot --nginx -d "$DOMAIN" --email "$SSL_EMAIL" --agree-tos --non-interactive --redirect
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}SSL certificate installed successfully!${NC}"
        else
            echo -e "${YELLOW}SSL setup failed. Try later with: sudo certbot --nginx -d $DOMAIN${NC}"
        fi
    fi
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Deployment Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
if check_command certbot && [[ ! "$setup_ssl" =~ ^[Nn]$ ]]; then
    echo -e "Your app is available at: ${GREEN}https://$DOMAIN${NC}"
else
    echo -e "Your app is available at: ${GREEN}http://$DOMAIN${NC}"
fi
echo ""
echo -e "${YELLOW}Default superadmin login:${NC}"
echo "  Username: adhielesmana"
echo "  Password: admin123"
echo ""
echo -e "${RED}IMPORTANT: Change the superadmin password after first login!${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:     docker compose logs -f"
echo "  Restart:       docker compose restart"
echo "  Stop:          docker compose down"
echo "  Rebuild:       docker compose up -d --build"
echo ""
