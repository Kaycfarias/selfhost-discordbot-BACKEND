import { metricsWSS } from "../websocket-servers";
import Docker from "dockerode";
import { IncomingMessage } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import type { WebSocket } from "ws";

interface ContainerMetrics {
  botId: string;
  timestamp: string;
  cpuPercent: string;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: string;
  networkRx: number;
  networkTx: number;
  status: string;
  running: boolean;
  restarting: boolean;
  paused: boolean;
  uptime: string;
  restartCount: number;
}

interface Connection {
  ws: WebSocket;
  container: Docker.Container;
  containerInfo: any;
  statsStream?: Readable;
  pingInterval?: NodeJS.Timeout;
  statusInterval?: NodeJS.Timeout;
  restartTimeout?: NodeJS.Timeout;
  isRestarting?: boolean;
}

const docker = new Docker();
const connections = new Map<string, Connection>();

// Utilities
const formatUptime = (startedAt: string): string => {
  if (!startedAt) return "0h 0m";
  const diff = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

const isOpen = (ws: WebSocket): boolean => ws.readyState === ws.OPEN;

const send = (ws: WebSocket, data: any): void => {
  if (isOpen(ws)) ws.send(JSON.stringify(data));
};

const sendError = (ws: WebSocket, message: string): void => {
  send(ws, { error: message, timestamp: new Date().toISOString() });
};

// Process metrics
const processMetrics = (rawData: any, botId: string, containerInfo: any, isRestarting: boolean): ContainerMetrics => {
  // CPU
  const cpuDelta = rawData.cpu_stats.cpu_usage.total_usage - (rawData.precpu_stats.cpu_usage?.total_usage || 0);
  const systemDelta = rawData.cpu_stats.system_cpu_usage - (rawData.precpu_stats.system_cpu_usage || 0);
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * (rawData.cpu_stats.online_cpus || 1) * 100 : 0;

  // Memory
  const memoryUsage = rawData.memory_stats.usage || 0;
  const memoryLimit = rawData.memory_stats.limit || containerInfo?.HostConfig?.Memory || 0;
  const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

  // Network
  const networks = rawData.networks || {};
  let networkRx = 0, networkTx = 0;
  Object.values(networks).forEach((network: any) => {
    networkRx += network.rx_bytes || 0;
    networkTx += network.tx_bytes || 0;
  });

  return {
    botId,
    timestamp: new Date().toISOString(),
    cpuPercent: cpuPercent.toFixed(2),
    memoryUsage,
    memoryLimit,
    memoryPercent: memoryPercent.toFixed(2),
    networkRx,
    networkTx,
    status: containerInfo?.State?.Status || "unknown",
    running: containerInfo?.State?.Running || false,
    restarting: isRestarting || containerInfo?.State?.Restarting || false,
    paused: containerInfo?.State?.Paused || false,
    uptime: formatUptime(containerInfo?.State?.StartedAt || ""),
    restartCount: containerInfo?.RestartCount || 0,
  };
};

// Start stats stream
const startStatsStream = async (botId: string): Promise<void> => {
  const connection = connections.get(botId);
  if (!connection) return;

  try {
    const rawStream = await connection.container.stats({ stream: true });
    connection.statsStream = rawStream as Readable;

    connection.statsStream.on("data", (chunk: Buffer) => {
      const rawText = chunk.toString().trim();
      if (!rawText) return;

      const lines = rawText.split("\n").filter(line => line.trim());
      for (const line of lines) {
        try {
          const rawData = JSON.parse(line);
          const metrics = processMetrics(rawData, botId, connection.containerInfo, connection.isRestarting || false);
          send(connection.ws, metrics);
        } catch {}
      }
    });

    connection.statsStream.on("error", () => {});
  } catch {}
};

// Status polling for restart detection
const startStatusPolling = (botId: string): void => {
  const connection = connections.get(botId);
  if (!connection) return;

  connection.statusInterval = setInterval(async () => {
    if (!isOpen(connection.ws)) {
      cleanup(botId);
      return;
    }

    try {
      const info = await connection.container.inspect();
      const wasRestarting = connection.isRestarting;
      const isRestarting = info?.State?.Restarting || false;

      if (isRestarting && !wasRestarting) {
        connection.isRestarting = true;
        
        if (connection.restartTimeout) clearTimeout(connection.restartTimeout);
        connection.restartTimeout = setTimeout(() => {
          if (connection.isRestarting) connection.isRestarting = false;
        }, 5000);

        send(connection.ws, {
          botId,
          timestamp: new Date().toISOString(),
          cpuPercent: "0.00",
          memoryUsage: 0,
          memoryLimit: 0,
          memoryPercent: "0.00",
          networkRx: 0,
          networkTx: 0,
          status: info?.State?.Status || "unknown",
          running: info?.State?.Running || false,
          restarting: true,
          paused: info?.State?.Paused || false,
          uptime: formatUptime(info?.State?.StartedAt || ""),
          restartCount: info?.RestartCount || 0,
        });
      } else if (!isRestarting && wasRestarting) {
        connection.isRestarting = false;
        if (connection.restartTimeout) clearTimeout(connection.restartTimeout);
      }

      connection.containerInfo = info;
    } catch {}
  }, 1000);
};

// Ping interval
const startPing = (botId: string): void => {
  const connection = connections.get(botId);
  if (!connection) return;

  connection.pingInterval = setInterval(() => {
    if (isOpen(connection.ws)) {
      connection.ws.ping();
    } else {
      cleanup(botId);
    }
  }, 30000);
};

// Cleanup
const cleanup = (botId: string): void => {
  const connection = connections.get(botId);
  if (!connection) return;

  if (connection.statsStream) connection.statsStream.destroy();
  if (connection.pingInterval) clearInterval(connection.pingInterval);
  if (connection.statusInterval) clearInterval(connection.statusInterval);
  if (connection.restartTimeout) clearTimeout(connection.restartTimeout);

  connections.delete(botId);
};

// Handle new connection
const handleConnection = async (ws: WebSocket, botId: string): Promise<void> => {
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
      isRestarting: false
    };

    connections.set(botId, connection);

    await startStatsStream(botId);
    startStatusPolling(botId);
    startPing(botId);

    ws.on("close", () => cleanup(botId));
    ws.on("error", () => cleanup(botId));

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

export function handleMetricsUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
  metricsWSS.handleUpgrade(req, socket, head, (ws) => {
    metricsWSS.emit("connection", ws, req);
  });
}
