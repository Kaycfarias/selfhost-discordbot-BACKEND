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
  uptime: string;
}

function formatUptime(startedAt: string): string {
  if (!startedAt) return "0h 0m";
  const diff = Date.now() - new Date(startedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function isWebSocketOpen(ws: WebSocket): boolean {
  return ws.readyState === ws.OPEN;
}

function sendError(ws: WebSocket, message: string): void {
  if (!isWebSocketOpen(ws)) return;
  ws.send(
    JSON.stringify({ error: message, timestamp: new Date().toISOString() })
  );
}

function sendMetrics(ws: WebSocket, metrics: ContainerMetrics): void {
  if (!isWebSocketOpen(ws)) return;
  ws.send(JSON.stringify(metrics));
}

function processMetrics(
  rawData: any,
  botId: string,
  containerInfo: any
): ContainerMetrics {
  // CPU
  const cpuDelta =
    rawData.cpu_stats.cpu_usage.total_usage -
    (rawData.precpu_stats.cpu_usage?.total_usage || 0);
  const systemCpuDelta =
    rawData.cpu_stats.system_cpu_usage -
    (rawData.precpu_stats.system_cpu_usage || 0);
  const cpuPercent =
    systemCpuDelta > 0 && cpuDelta >= 0
      ? (cpuDelta / systemCpuDelta) * (rawData.cpu_stats.online_cpus || 1) * 100
      : 0;

  // Memória
  const memoryUsage = rawData.memory_stats.usage || 0;
  // Se o container estiver desligado, tente obter o limite de memória do containerInfo
  const memoryLimit =
    rawData.memory_stats.limit || containerInfo?.HostConfig?.Memory || 0;
  const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

  // Rede
  const networks = rawData.networks || {};
  let networkRx = 0,
    networkTx = 0;
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
    uptime: formatUptime(containerInfo?.State?.StartedAt || ""),
  };
}

const docker = new Docker();
const activeConnections = new Map<
  string,
  {
    ws: WebSocket;
    statsStream?: Readable;
    eventsStream?: Readable;
    pingInterval?: NodeJS.Timeout;
    containerInfo?: any;
  }
>();

async function handleMetricsConnection(
  ws: WebSocket,
  botId: string
): Promise<void> {
  try {
    const container = docker.getContainer(`bot-${botId}-container`);
    const containerInfo = await container.inspect();

    if (!containerInfo?.State?.Status) {
      sendError(ws, "Container não encontrado");
      ws.close();
      return;
    }

    const connection = {
      ws,
      containerInfo,
      statsStream: undefined as Readable | undefined,
      eventsStream: undefined as Readable | undefined,
      pingInterval: undefined as NodeJS.Timeout | undefined,
    };
    activeConnections.set(botId, connection);

    await startMetricsStream(botId, container);
    await startDockerEventsStream(botId, containerInfo.Id);

    // Ping interval
    connection.pingInterval = setInterval(() => {
      if (isWebSocketOpen(ws)) ws.ping();
      else cleanup(botId);
    }, 30000);

    // Adicionar verificação rápida para capturar status transitórios como "restarting"
    const statusCheckInterval = setInterval(async () => {
      if (!isWebSocketOpen(ws)) {
        clearInterval(statusCheckInterval);
        return;
      }

      try {
        const container = docker.getContainer(`bot-${botId}-container`);
        const currentInfo = await container.inspect();
        const currentStatus = currentInfo.State?.Status;
        const previousStatus = connection.containerInfo?.State?.Status;

        if (currentStatus !== previousStatus) {
          console.log(
            `🔍 Verificação de status: bot ${botId}: ${previousStatus} → ${currentStatus}`
          );
          connection.containerInfo = currentInfo;

          // Enviar métricas atualizadas
          if (connection.ws && isWebSocketOpen(connection.ws)) {
            const statusMetrics = {
              botId,
              timestamp: new Date().toISOString(),
              cpuPercent: "0.00",
              memoryUsage: 0,
              memoryLimit: 0,
              memoryPercent: "0.00",
              networkRx: 0,
              networkTx: 0,
              status: currentStatus,
              uptime: formatUptime(currentInfo?.State?.StartedAt || ""),
            };
            sendMetrics(connection.ws, statusMetrics);
          }
        }
      } catch (error) {
        // Container pode não existir durante restart
      }
    }, 1000);

    // Event handlers
    ws.on("close", () => cleanup(botId));
    ws.on("error", () => cleanup(botId));
  } catch (error: any) {
    sendError(ws, `Erro: ${error.message}`);
    ws.close();
  }
}

async function startMetricsStream(
  botId: string,
  container: Docker.Container
): Promise<void> {
  try {
    const connection = activeConnections.get(botId);
    if (!connection) return;

    const rawStream = await container.stats({ stream: true });
    connection.statsStream = rawStream as Readable;

    connection.statsStream.on("data", (chunk: Buffer) => {
      try {
        const rawText = chunk.toString().trim();
        if (!rawText) return;

        // Docker pode enviar múltiplos JSONs separados por \n
        const lines = rawText.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const rawData = JSON.parse(line);
            const metrics = processMetrics(
              rawData,
              botId,
              connection.containerInfo
            );
            sendMetrics(connection.ws, metrics);
          } catch (parseError) {
            // Ignorar erros de parse
          }
        }
      } catch (error) {
        console.error(`Erro métricas bot ${botId}`);
      }
    });

    connection.statsStream.on("error", (error) => {
      console.error(`❌ Erro na stream bot ${botId}:`, error);
    });
  } catch (error) {
    console.error(`❌ Erro ao iniciar stream bot ${botId}:`, error);
  }
}

async function startDockerEventsStream(
  botId: string,
  containerId: string
): Promise<void> {
  try {
    const connection = activeConnections.get(botId);
    if (!connection) return;

    const eventsStream = await docker.getEvents({
      filters: {
        container: [containerId],
        event: [
          "create",
          "start",
          "stop",
          "restart",
          "pause",
          "unpause",
          "die",
          "kill",
          "destroy",
        ],
      },
    });

    connection.eventsStream = eventsStream as Readable;

    connection.eventsStream.on("data", async (chunk: Buffer) => {
      try {
        const rawText = chunk.toString().trim();
        if (!rawText) return;

        // Docker events também podem vir em múltiplas linhas
        const lines = rawText.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            const container = docker.getContainer(containerId);
            const updatedInfo = await container.inspect();

            connection.containerInfo = updatedInfo;

            if (connection.ws && isWebSocketOpen(connection.ws)) {
              const currentMetrics = {
                botId,
                timestamp: new Date().toISOString(),
                cpuPercent: "0.00",
                memoryUsage: 0,
                memoryLimit: 0,
                memoryPercent: "0.00",
                networkRx: 0,
                networkTx: 0,
                status: updatedInfo.State?.Status,
                uptime: formatUptime(updatedInfo?.State?.StartedAt || ""),
              };
              sendMetrics(connection.ws, currentMetrics);
            }
          } catch (parseError) {
            // Ignorar erros de parse
          }
        }
      } catch (error) {}
    });

    connection.eventsStream.on("error", () => {});
  } catch (error) {}
}

function cleanup(botId: string): void {
  const connection = activeConnections.get(botId);
  if (!connection) return;

  if (connection.statsStream) connection.statsStream.destroy();
  if (connection.eventsStream) connection.eventsStream.destroy();
  if (connection.pingInterval) clearInterval(connection.pingInterval);

  activeConnections.delete(botId);
}

metricsWSS.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const botId = url.searchParams.get("botId");

  if (!botId) {
    sendError(ws, "botId não fornecido");
    ws.close();
    return;
  }

  await handleMetricsConnection(ws, botId);
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
