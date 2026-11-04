# OD — Ordem de Demandas
# Imagem de produção: só as dependências de runtime, rodando como usuário sem privilégio.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4646

# dependências primeiro: a camada só é refeita quando o package*.json muda
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 4646

# a tela de login responde sem sessão: serve de sinal de vida
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4646)+'/entrar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
