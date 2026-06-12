FROM node:22-alpine

# Install system dependencies including curl for pdf-to-markdown
RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# Install pdf-to-markdown nutrient CLI binary
RUN mkdir -p /root/.local/share/nutrient/cli && \
    TARGET_ID="linux-amd64" && \
    LATEST=$(curl -fsSL https://agent-cdn.nutrient.io/pdf-to-markdown/LATEST | tr -d '\r\n') && \
    curl -fsSL "https://agent-cdn.nutrient.io/pdf-to-markdown/${LATEST}/${TARGET_ID}.tar.gz" | tar -xzf - -C /root/.local/share/nutrient/cli && \
    chmod +x /root/.local/share/nutrient/cli/nutrient-linux-amd64 && \
    printf 'LAST_CHECKED_AT=%s\nRELEASE_ID=%s\n' "$(date +%s)" "$LATEST" > /root/.local/share/nutrient/pdf-to-markdown-state

COPY . .

EXPOSE 3000
CMD ["npm", "start"]