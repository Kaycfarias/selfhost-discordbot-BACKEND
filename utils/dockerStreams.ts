import Docker from "dockerode";
import { Readable } from "stream";
import type { Connection } from "./websocketHelpers";
import { send } from "./websocketHelpers";
import { processMetrics } from "./metricsCalculator";

const MONITORED_EVENTS = [
  "start",
  "restart",
  "stop",
  "die",
  "kill",
  "pause",
  "unpause",
];

export const startEventsStream = async (
  botId: string,
  connections: Map<string, Connection>,
  docker: Docker
): Promise<void> => {
  const connection = connections.get(botId);
  if (!connection) return;

  try {
    const containerId = connection.container.id;
    const eventsStream = await docker.getEvents({
      filters: { container: [containerId] },
    });

    connection.eventsStream = eventsStream as Readable;

    connection.eventsStream.on("data", async (chunk: Buffer) => {
      try {
        const event = JSON.parse(chunk.toString());
        const action = event.Action || event.status; // Docker API compatibility

        // Handle container state changes that affect uptime
        if (MONITORED_EVENTS.includes(action)) {
          console.log(`Docker event: ${action} for botId: ${botId}`);

          // Update container info when state changes
          try {
            connection.containerInfo = await connection.container.inspect();
          } catch (error) {
            console.error(`Error updating container info for ${botId}:`, error);
          }
        }
      } catch (error) {
        // Silently handle JSON parse errors
      }
    });

    connection.eventsStream.on("error", (error) => {
      console.error(`Events stream error for ${botId}:`, error);
    });
  } catch (error) {
    console.error(`Error starting events stream for ${botId}:`, error);
  }
};

export const startStatsStream = async (
  botId: string,
  connections: Map<string, Connection>
): Promise<void> => {
  const connection = connections.get(botId);
  if (!connection) return;

  try {
    const rawStream = await connection.container.stats({ stream: true });
    connection.statsStream = rawStream as Readable;

    connection.statsStream.on("data", (chunk: Buffer) => {
      const rawText = chunk.toString().trim();
      if (!rawText) return;

      const lines = rawText.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        try {
          const rawData = JSON.parse(line);
          const metrics = processMetrics(
            rawData,
            botId,
            connection.containerInfo,
            false
          );
          send(connection.ws, metrics);
        } catch {
          // Silently handle JSON parse errors
        }
      }
    });

    connection.statsStream.on("error", () => {
      // Silently handle stream errors
    });
  } catch {
    // Silently handle connection errors
  }
};
