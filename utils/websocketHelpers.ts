import Docker from "dockerode";
import { Readable } from "stream";
import type { WebSocket } from "ws";

export interface Connection {
  ws: WebSocket;
  container: Docker.Container;
  containerInfo: any;
  statsStream?: Readable;
  pingInterval?: NodeJS.Timeout;
  eventsStream?: Readable;
}

export const isOpen = (ws: WebSocket): boolean => ws.readyState === ws.OPEN;

export const send = (ws: WebSocket, data: any): void => {
  if (isOpen(ws)) ws.send(JSON.stringify(data));
};

export const sendError = (ws: WebSocket, message: string): void => {
  send(ws, { error: message, timestamp: new Date().toISOString() });
};

export const cleanup = (
  botId: string,
  connections: Map<string, Connection>
): void => {
  const connection = connections.get(botId);
  if (!connection) return;

  if (connection.statsStream) connection.statsStream.destroy();
  if (connection.eventsStream) connection.eventsStream.destroy();
  if (connection.pingInterval) clearInterval(connection.pingInterval);

  connections.delete(botId);
};
