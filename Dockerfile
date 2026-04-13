FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY template-store ./template-store
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

WORKDIR /app/backend
CMD ["npm", "start"]
