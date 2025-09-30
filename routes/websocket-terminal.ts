import { terminalWSS } from "../websocket-servers";
import { IncomingMessage } from "http";
import { Socket } from "net";
import Docker from "dockerode";
import type { WebSocket } from "ws";

// Utils imports
import type { TerminalConnection } from "../utils";
import {
  terminalError as sendError,
  sendStatus,
  cleanupTerminalConnection,
  sendRecentLogs,
  startLiveLogsStream,
  startContainerMonitoring,
} from "../utils";

const docker = new Docker();
const connections = new Map<string, TerminalConnection>();

// Handle new terminal connection
const handleTerminalConnection = async (
  ws: WebSocket,
  botId: string
): Promise<void> => {
  try {
    const container = docker.getContainer(`bot-${botId}-container`);
    const containerInfo = await container.inspect();

    if (!containerInfo?.State) {
      sendError(ws, "Container não encontrado");
      ws.close();
      return;
    }

    const connection: TerminalConnection = {
      ws,
      container,
      botId,
      isRunning: containerInfo.State.Running,
    };

    connections.set(botId, connection);

    // Always send recent logs first
    await sendRecentLogs(container, ws);

    if (connection.isRunning) {
      sendStatus(ws, "Conectado - Transmitindo logs em tempo real");
      await startLiveLogsStream(connection);
    } else {
      sendStatus(ws, "Bot parado - Aguardando inicialização...");
      await startContainerMonitoring(connection);
    }

    // Setup cleanup on disconnect
    ws.on("close", () => {
      const conn = connections.get(botId);
      if (conn) {
        cleanupTerminalConnection(conn);
        connections.delete(botId);
      }
    });

    ws.on("error", () => {
      const conn = connections.get(botId);
      if (conn) {
        cleanupTerminalConnection(conn);
        connections.delete(botId);
      }
    });
  } catch (error: any) {
    sendError(ws, `Não foi possível acessar o container: ${error.message}`);
    ws.close();
  }
};

terminalWSS.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const botId = url.searchParams.get("botId");

  if (!botId) {
    sendError(ws, "botId não fornecido");
    ws.close();
    return;
  }

  await handleTerminalConnection(ws, botId);
});

export function handleTerminalUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer
) {
  terminalWSS.handleUpgrade(req, socket, head, (ws) => {
    terminalWSS.emit("connection", ws, req);
  });
}
