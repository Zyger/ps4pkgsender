FROM node:20-alpine AS deps
WORKDIR /pkg_sender
COPY package.json package-lock*.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /pkg_sender
RUN apk --no-cache add curl
ENV NODE_ENV=production
COPY --from=deps /pkg_sender/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
CMD ["npm", "start"]
