import { metricsWSS } from "../websocket-servers";
import Docker from "dockerode";
import { IncomingMessage } from "http";
import { Socket } from "net";
import { Readable } from "stream";

const docker = new Docker();

metricsWSS.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const botId = url.searchParams.get("botId");
  if (!botId) {
    ws.send(JSON.stringify({ error: "botId não fornecido" }));
    return ws.close();
  }

  const containerName = `bot-${botId}-container`;
  const container = docker.getContainer(containerName);

  try {
    const rawStream = await container.stats({
      stream: true,
    });
    const statsStream = rawStream as Readable;

    statsStream.on("data", (chunk: Buffer) => {
      try {
        const data = JSON.parse(chunk.toString());

        const cpuDelta =
          data.cpu_stats.cpu_usage.total_usage -
          data.precpu_stats.cpu_usage.total_usage;
        const systemCpuDelta =
          data.cpu_stats.system_cpu_usage - data.precpu_stats.system_cpu_usage;
        const cpuPercent =
          systemCpuDelta > 0
            ? (cpuDelta / systemCpuDelta) * data.cpu_stats.online_cpus * 100
            : 0;

        const memoryUsage = data.memory_stats.usage;
        const memoryLimit = data.memory_stats.limit;
        const memoryPercent = (memoryUsage / memoryLimit) * 100;

        ws.send(
          JSON.stringify({
            cpuPercent: cpuPercent.toFixed(2),
            memoryUsage,
            memoryLimit,
            memoryPercent: memoryPercent.toFixed(2),
            sts: data?.pids_stats?.current || 0,
          })
        );
      } catch (error) {
        console.error("Erro ao processar dados de métricas:", error);
      }
    });
    statsStream.on("error", (err) => {
      console.error("Erro na stream de stats:", err);
      ws.send(JSON.stringify({ error: "Erro na stream de stats" }));
      ws.close();
    });

    ws.on("close", () => {
      statsStream.destroy(); // o erro é provavelmente bug do TS
    });

    ws.on("error", () => {
      statsStream.destroy(); // o erro é provavelmente bug do TS
    });
  } catch (error) {
    console.error("Erro ao obter stats do container:", error);
    ws.send(JSON.stringify({ error: "Erro ao iniciar stream de stats" }));
    ws.close();
  }
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
