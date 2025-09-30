import type { WebSocket } from "ws";
import Docker from "dockerode";
import { Readable } from "stream";

export interface TerminalConnection {
  ws: WebSocket;
  container: Docker.Container;
  botId: string;
  logsStream?: Readable;
  eventsStream?: Readable;
  isRunning: boolean;
}

export const isWebSocketOpen = (ws: WebSocket): boolean =>
  ws.readyState === ws.OPEN;

export const sendMessage = (ws: WebSocket, message: string): void => {
  if (isWebSocketOpen(ws)) {
    ws.send(message);
  }
};

export const sendError = (ws: WebSocket, error: string): void => {
  sendMessage(ws, `[Erro] ${error}`);
};

export const sendStatus = (ws: WebSocket, status: string): void => {
  sendMessage(ws, `\x1b[1;37;41m ${status}\x1b[0m \r\n`);
};

export const cleanupTerminalConnection = (
  connection: TerminalConnection
): void => {
  if (connection.logsStream) {
    connection.logsStream.destroy();
  }

  if (connection.eventsStream) {
    connection.eventsStream.destroy();
  }

  if (isWebSocketOpen(connection.ws)) {
    connection.ws.close();
  }
};
