FROM node:22-alpine

# Install system dependencies including curl for pdf-to-markdown
RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Install pdf-to-markdown nutrient CLI binary by triggering auto-download
RUN touch /tmp/dummy.pdf && HOME=/root /app/node_modules/.bin/pdf-to-markdown /tmp/dummy.pdf /tmp/dummy.md 2>&1 || true && \
    ls -la /root/.local/share/nutrient/cli/ && \
    rm -f /tmp/dummy.pdf /tmp/dummy.md

# Ensure HOME is consistent at runtime (wrapper script uses $HOME to locate binary)
ENV HOME=/root

EXPOSE 3000
CMD ["npm", "start"]