import { metricsWSS } from "../websocket-servers";
import Docker from "dockerode";
import { IncomingMessage } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import type { WebSocket } from "ws";

interface IContainerMetrics {
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

interface IErrorMessage {
  error: string;
  timestamp: string;
}

interface IMetricsProcessor {
  processRawData(
    rawData: any,
    botId: string,
    containerInfo: any
  ): IContainerMetrics;
}

interface IConnectionManager {
  handleConnection(ws: WebSocket, botId: string): Promise<void>;
  cleanup(): void;
}

interface IWebSocketUtils {
  sendError(ws: WebSocket, message: string): void;
  sendMetrics(ws: WebSocket, metrics: IContainerMetrics): void;
  isOpen(ws: WebSocket): boolean;
}

class TimeUtils {
  static formatUptime(startedAt: string): string {
    const start = new Date(startedAt);
    const now = new Date();
    const diff = now.getTime() - start.getTime();

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  }

  static getCurrentTimestamp(): string {
    return new Date().toISOString();
  }
}

class WebSocketUtils implements IWebSocketUtils {
  sendError(ws: WebSocket, message: string): void {
    if (!this.isOpen(ws)) return;

    const errorMsg: IErrorMessage = {
      error: message,
      timestamp: TimeUtils.getCurrentTimestamp(),
    };
    ws.send(JSON.stringify(errorMsg));
  }

  sendMetrics(ws: WebSocket, metrics: IContainerMetrics): void {
    if (!this.isOpen(ws)) return;
    ws.send(JSON.stringify(metrics));
  }

  isOpen(ws: WebSocket): boolean {
    return ws.readyState === ws.OPEN;
  }
}

class ContainerMetricsProcessor implements IMetricsProcessor {
  processRawData(
    rawData: any,
    botId: string,
    containerInfo: any
  ): IContainerMetrics {
    const cpuMetrics = this.calculateCpuMetrics(rawData);
    const memoryMetrics = this.calculateMemoryMetrics(rawData);
    const networkMetrics = this.calculateNetworkMetrics(rawData);

    return {
      botId,
      timestamp: TimeUtils.getCurrentTimestamp(),
      cpuPercent: cpuMetrics.toFixed(2),
      memoryUsage: memoryMetrics.usage,
      memoryLimit: memoryMetrics.limit,
      memoryPercent: memoryMetrics.percent.toFixed(2),
      networkRx: networkMetrics.rx,
      networkTx: networkMetrics.tx,
      status: containerInfo.State.Status || "unknown",
      uptime: TimeUtils.formatUptime(containerInfo.State.StartedAt || ""),
    };
  }

  private calculateCpuMetrics(rawData: any): number {
    const cpuDelta =
      rawData.cpu_stats.cpu_usage.total_usage -
      (rawData.precpu_stats.cpu_usage?.total_usage || 0);
    const systemCpuDelta =
      rawData.cpu_stats.system_cpu_usage -
      (rawData.precpu_stats.system_cpu_usage || 0);

    if (systemCpuDelta <= 0 || cpuDelta < 0) return 0;

    return (
      (cpuDelta / systemCpuDelta) * (rawData.cpu_stats.online_cpus || 1) * 100
    );
  }

  private calculateMemoryMetrics(rawData: any): {
    usage: number;
    limit: number;
    percent: number;
  } {
    const usage = rawData.memory_stats.usage || 0;
    const limit = rawData.memory_stats.limit || 0;
    const percent = limit > 0 ? (usage / limit) * 100 : 0;

    return { usage, limit, percent };
  }

  private calculateNetworkMetrics(rawData: any): { rx: number; tx: number } {
    const networks = rawData.networks || {};
    let rx = 0;
    let tx = 0;

    Object.values(networks).forEach((network: any) => {
      rx += network.rx_bytes || 0;
      tx += network.tx_bytes || 0;
    });

    return { rx, tx };
  }
}

class MetricsConnectionManager implements IConnectionManager {
  private docker: Docker;
  private metricsProcessor: IMetricsProcessor;
  private webSocketUtils: IWebSocketUtils;
  private statsStream: Readable | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor(
    docker: Docker,
    metricsProcessor: IMetricsProcessor,
    webSocketUtils: IWebSocketUtils
  ) {
    this.docker = docker;
    this.metricsProcessor = metricsProcessor;
    this.webSocketUtils = webSocketUtils;
  }

  async handleConnection(ws: WebSocket, botId: string): Promise<void> {
    console.log(`📊 WebSocket métricas conectado para bot: ${botId}`);

    try {
      const container = this.docker.getContainer(`bot-${botId}-container`);
      const containerInfo = await this.validateContainer(ws, container);

      if (!containerInfo) return;

      await this.initializeMetricsStream(ws, container, botId, containerInfo);
      this.setupConnectionHandlers(ws, botId);
    } catch (error: any) {
      console.error(`🚨 Erro ao iniciar métricas para bot ${botId}:`, error);
      this.webSocketUtils.sendError(
        ws,
        `Container não encontrado: ${error.message}`
      );
      ws.close();
    }
  }

  private async validateContainer(
    ws: WebSocket,
    container: Docker.Container
  ): Promise<any | null> {
    const containerInfo = await container.inspect();

    if (!containerInfo.State.Running) {
      this.webSocketUtils.sendError(ws, "Container não está rodando");
      ws.close();
      return null;
    }

    return containerInfo;
  }

  private async initializeMetricsStream(
    ws: WebSocket,
    container: Docker.Container,
    botId: string,
    containerInfo: any
  ): Promise<void> {
    const rawStream = await container.stats({ stream: true });
    this.statsStream = rawStream as Readable;

    this.statsStream.on("data", (chunk: Buffer) => {
      this.handleMetricsData(ws, chunk, botId, containerInfo);
    });

    this.statsStream.on("error", (err) => {
      console.error(`Erro na stream para bot ${botId}:`, err);
      if (this.webSocketUtils.isOpen(ws)) {
        this.webSocketUtils.sendError(ws, "Erro na stream de métricas");
        ws.close();
      }
    });
  }

  private handleMetricsData(
    ws: WebSocket,
    chunk: Buffer,
    botId: string,
    containerInfo: any
  ): void {
    try {
      const rawData = JSON.parse(chunk.toString());
      const metrics = this.metricsProcessor.processRawData(
        rawData,
        botId,
        containerInfo
      );

      this.webSocketUtils.sendMetrics(ws, metrics);
    } catch (parseError) {
      console.error("Erro ao processar métricas:", parseError);
      if (this.webSocketUtils.isOpen(ws)) {
        this.webSocketUtils.sendError(ws, "Erro ao processar dados");
      }
    }
  }

  private setupConnectionHandlers(ws: WebSocket, botId: string): void {
    this.metricsInterval = setInterval(() => {
      if (this.webSocketUtils.isOpen(ws)) {
        ws.ping();
      } else {
        this.cleanup();
      }
    }, 30000);


    const cleanup = () => {
      console.log(`WebSocket métricas desconectado para bot: ${botId}`);
      this.cleanup();
    };

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      console.error(`Erro no WebSocket para bot ${botId}:`, err);
      cleanup();
    });
  }

  cleanup(): void {
    if (this.statsStream?.destroy) {
      this.statsStream.destroy();
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    this.statsStream = null;
    this.metricsInterval = null;
  }
}

class MetricsRequestHandler {
  private connectionManager: IConnectionManager;
  private webSocketUtils: IWebSocketUtils;

  constructor(
    connectionManager: IConnectionManager,
    webSocketUtils: IWebSocketUtils
  ) {
    this.connectionManager = connectionManager;
    this.webSocketUtils = webSocketUtils;
  }

  async handleWebSocketConnection(
    ws: WebSocket,
    req: IncomingMessage
  ): Promise<void> {
    const botId = this.extractBotId(req);

    if (!botId) {
      this.webSocketUtils.sendError(ws, "botId não fornecido");
      return ws.close();
    }

    await this.connectionManager.handleConnection(ws, botId);
  }

  private extractBotId(req: IncomingMessage): string | null {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    return url.searchParams.get("botId");
  }
}

// FACTORY - Dependency Injection (Dependency Inversion)
class MetricsServiceFactory {
  static create(): MetricsRequestHandler {
    const docker = new Docker();
    const webSocketUtils = new WebSocketUtils();
    const metricsProcessor = new ContainerMetricsProcessor();
    const connectionManager = new MetricsConnectionManager(
      docker,
      metricsProcessor,
      webSocketUtils
    );

    return new MetricsRequestHandler(connectionManager, webSocketUtils);
  }
}

// BOOTSTRAP - Clean initialization
const metricsService = MetricsServiceFactory.create();

metricsWSS.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  await metricsService.handleWebSocketConnection(ws, req);
});

// WEBSOCKET UPGRADE HANDLER
export function handleMetricsUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer
) {
  metricsWSS.handleUpgrade(req, socket, head, (ws) => {
    metricsWSS.emit("connection", ws, req);
  });
}
