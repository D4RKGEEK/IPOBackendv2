FROM node:22-alpine

# Install system dependencies including curl for pdf-to-markdown
RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000
CMD ["npm", "start"]