import formatUptime from "./format-uptime";

export interface ContainerMetrics {
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
  startedAt: string;
  finishedAt: string;
  uptime: string;
  restartCount: number;
}

export const calculateCpuPercent = (rawData: any): number => {
  const cpuDelta =
    rawData.cpu_stats.cpu_usage.total_usage -
    (rawData.precpu_stats.cpu_usage?.total_usage || 0);
  const systemDelta =
    rawData.cpu_stats.system_cpu_usage -
    (rawData.precpu_stats.system_cpu_usage || 0);

  return systemDelta > 0
    ? (cpuDelta / systemDelta) * (rawData.cpu_stats.online_cpus || 1) * 100
    : 0;
};

export const calculateMemoryMetrics = (rawData: any, containerInfo: any) => {
  const memoryUsage = rawData.memory_stats.usage || 0;
  const memoryLimit =
    rawData.memory_stats.limit || containerInfo?.HostConfig?.Memory || 0;
  const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

  return { memoryUsage, memoryLimit, memoryPercent };
};

export const calculateNetworkMetrics = (rawData: any) => {
  const networks = rawData.networks || {};
  let networkRx = 0;
  let networkTx = 0;

  Object.values(networks).forEach((network: any) => {
    networkRx += network.rx_bytes || 0;
    networkTx += network.tx_bytes || 0;
  });

  return { networkRx, networkTx };
};

export const calculateUptime = (containerInfo: any): string => {
  const status = containerInfo?.State?.Status || "unknown";
  const startedAt = containerInfo?.State?.StartedAt || "";
  const finishedAt = containerInfo?.State?.FinishedAt || "";
  const isRunning = containerInfo?.State?.Running || false;

  // Calculate uptime based on current state
  if (isRunning && startedAt) {
    return formatUptime(startedAt);
  } else if (!isRunning && status === "exited" && finishedAt && startedAt) {
    // For stopped containers, show how long they were running
    const startTime = new Date(startedAt).getTime();
    const endTime = new Date(finishedAt).getTime();

    if (!isNaN(startTime) && !isNaN(endTime) && endTime > startTime) {
      const duration = endTime - startTime;
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      return `Ran for ${hours}h:${minutes.toString().padStart(2, "0")}m`;
    }
  }

  return "N/A";
};

export const processMetrics = (
  rawData: any,
  botId: string,
  containerInfo: any,
  isRestarting: boolean
): ContainerMetrics => {
  const cpuPercent = calculateCpuPercent(rawData);
  const { memoryUsage, memoryLimit, memoryPercent } = calculateMemoryMetrics(
    rawData,
    containerInfo
  );
  const { networkRx, networkTx } = calculateNetworkMetrics(rawData);

  const status = containerInfo?.State?.Status || "unknown";
  const startedAt = containerInfo?.State?.StartedAt || "";
  const finishedAt = containerInfo?.State?.FinishedAt || "";
  const isRunning = containerInfo?.State?.Running || false;
  const uptime = calculateUptime(containerInfo);

  return {
    botId,
    timestamp: new Date().toISOString(),
    cpuPercent: cpuPercent.toFixed(2),
    memoryUsage,
    memoryLimit,
    memoryPercent: memoryPercent.toFixed(2),
    networkRx,
    networkTx,
    status,
    running: isRunning,
    restarting: isRestarting || containerInfo?.State?.Restarting || false,
    paused: containerInfo?.State?.Paused || false,
    startedAt,
    finishedAt,
    uptime,
    restartCount: containerInfo?.RestartCount || 0,
  };
};
