# disbit — бэкенд (Express + node:sqlite) + фронтенд статикой
# Требование: Node ≥ 22.13 (встроенный node:sqlite)
FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json backend/
RUN cd backend && npm install --omit=dev

COPY backend backend
COPY frontend frontend

ENV NODE_ENV=production
# БД кладём на persistent volume хостинга (иначе сотрётся при redeploy):
# смонтируй volume в /data и поставь переменную DB_PATH=/data/disbit.db
EXPOSE 3000

CMD ["node", "backend/server.js"]
