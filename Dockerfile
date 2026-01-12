FROM node:20-alpine

# Install git for update functionality
RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 5000

ENV NODE_ENV=production

CMD ["npm", "start"]
