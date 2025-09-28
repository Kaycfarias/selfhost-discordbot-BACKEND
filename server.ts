/**
 * Servidor híbrido Express + WebSocket
 * Serve HTTP e WebSocket na mesma porta
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
import stopBotContainerRoute from "./routes/stop-bot-container";
import restartBotContainerRoute from "./routes/restart-bot-container";

import swaggerUi from "swagger-ui-express";
import swaggerDocs from "./utils/swaggerdocs";

const app = express();
app.use(cors());
const port = 3001;

app.use(express.json());
app.use("/api", listBotsRoute);
app.use("/api", uploadBotRoute);
app.use("/api", stopBotContainerRoute);
app.use("/api", restartBotContainerRoute);

app.use("/", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

const server = http.createServer(app);

server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const wsHandlers: Record<
    string,
    (req: IncomingMessage, socket: Socket, head: Buffer) => void
  > = {
    "/api/ws-terminal": handleTerminalUpgrade,
    "/api/ws-metrics": handleMetricsUpgrade,
  };

  const pathname = req.url?.split("?")[0];

  if (pathname && wsHandlers[pathname]) {
    wsHandlers[pathname](req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`API + WebSocket rodando na porta ${port}`);
});
