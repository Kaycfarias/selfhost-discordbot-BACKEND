import { metricsWSS } from "../websocket-servers";
import Docker from "dockerode";
import { IncomingMessage } from "http";
import { Socket } from "net";
import type { WebSocket } from "ws";

// Utils imports
import type { Connection } from "../utils";
import {
  wsError as sendError,
  cleanup as cleanupConnection,
  isOpen,
  startEventsStream,
  startStatsStream,
} from "../utils";

const docker = new Docker();
const connections = new Map<string, Connection>();

// Ping interval
const startPing = (botId: string): void => {
  const connection = connections.get(botId);
  if (!connection) return;

  connection.pingInterval = setInterval(() => {
    if (isOpen(connection.ws)) {
      connection.ws.ping();
    } else {
      cleanupConnection(botId, connections);
    }
  }, 30000);
};

// Handle new connection
const handleConnection = async (
  ws: WebSocket,
  botId: string
): Promise<void> => {
  try {
    const container = docker.getContainer(`bot-${botId}-container`);
    const containerInfo = await container.inspect();

    if (!containerInfo?.State?.Status) {
      sendError(ws, "Container não encontrado");
      ws.close();
      return;
    }

    const connection: Connection = {
      ws,
      container,
      containerInfo,
    };

    connections.set(botId, connection);

    await startEventsStream(botId, connections, docker);
    await startStatsStream(botId, connections);
    startPing(botId);

    ws.on("close", () => cleanupConnection(botId, connections));
    ws.on("error", () => cleanupConnection(botId, connections));
  } catch (error: any) {
    sendError(ws, `Erro: ${error.message}`);
    ws.close();
  }
};

// WebSocket setup
metricsWSS.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const botId = url.searchParams.get("botId");

  if (!botId) {
    sendError(ws, "botId não fornecido");
    ws.close();
    return;
  }

  await handleConnection(ws, botId);
});

export function handleMetricsUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer
) {
  metricsWSS.handleUpgrade(req, socket, head, (ws) => {
    metricsWSS.emit("connection", ws, req);
  });
}
