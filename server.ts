/**
 * 🚀 SERVIDOR HÍBRIDO: Express + WebSocket
 *
 * Este servidor é GENIAL porque roda HTTP e WebSocket na mesma porta!
 *
 * Como funciona:
 * 1. Express gerencia rotas HTTP normais (/api/list-bots, /api/upload-bot)
 * 2. Event "upgrade" intercepta tentativas de WebSocket
 * 3. Roteia WebSockets por pathname (/api/ws-terminal, /api/ws-metrics)
 *
 * Resultado: Uma só porta serve tudo! 🎯
 */

import cors from "cors";
import express from "express";
import http from "http";
import { IncomingMessage } from "http";
import { Socket } from "net";

import { handleTerminalUpgrade } from "./routes/websocket-terminal";
import { handleMetricsUpgrade } from "./routes/websocket-metrics";

import uploadBotRoute from "./routes/upload-bot";
import listBotsRoute from "./routes/list-bots";

// Cria a aplicação Express para rotas HTTP normais
const app = express();
app.use(cors());
const port = 3001;

// Middleware para parsear JSON nas requisições HTTP
app.use(express.json());

// Registra as rotas HTTP da API REST
app.use("/api", listBotsRoute); // GET /api/list-bots
app.use("/api", uploadBotRoute); // POST /api/upload-bot

// 🔑 TRUQUE PRINCIPAL: Cria servidor HTTP que usa Express como handler
// Isso permite interceptar conexões WebSocket no mesmo servidor
const server = http.createServer(app);

// 🚀 Event Listener para "upgrade" - quando cliente quer trocar HTTP por WebSocket
// Quando cliente envia headers: Connection: Upgrade, Upgrade: websocket
server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  // 📋 Mapeamento de rotas WebSocket para seus respectivos handlers
  // Cada pathname direciona para um handler específico
  const wsHandlers: Record<
    string,
    (req: IncomingMessage, socket: Socket, head: Buffer) => void
  > = {
    "/api/ws-terminal": handleTerminalUpgrade, // WebSocket para terminal Docker
    "/api/ws-metrics": handleMetricsUpgrade, // WebSocket para métricas em tempo real
  };

  // 🔍 Extrai o pathname da URL (remove query parameters)
  // Exemplo: "/api/ws-terminal?botId=123" → "/api/ws-terminal"
  const pathname = req.url?.split("?")[0];

  // 🎯 Roteamento WebSocket: se existe handler para este pathname, executa
  if (pathname && wsHandlers[pathname]) {
    wsHandlers[pathname](req, socket, head);
  } else {
    // ❌ Rota WebSocket não encontrada - fecha conexão
    socket.destroy();
  }
});

// 🌐 Inicia o servidor na porta 3001
// Agora serve TANTO HTTP (Express) quanto WebSocket no mesmo porto!
server.listen(port, () => {
  console.log(`🛰️ API + WebSocket rodando na porta ${port}`);
});
