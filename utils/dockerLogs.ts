import Docker from "dockerode";
import { PassThrough, Readable } from "stream";
import type { WebSocket } from "ws";
import type { TerminalConnection } from "./terminalHelpers";
import {
  sendMessage,
  sendError,
  sendStatus,
  isWebSocketOpen,
  cleanupTerminalConnection,
} from "./terminalHelpers";

const decoder = new TextDecoder("utf-8");

export const sendRecentLogs = async (
  container: Docker.Container,
  ws: WebSocket
): Promise<void> => {
  try {
    const buffer = await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail: 100,
    });

    const bufferStream = new Readable();
    bufferStream.push(buffer);
    bufferStream.push(null);

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    container.modem.demuxStream(bufferStream, stdout, stderr);

    const sendChunk = (chunk: Buffer) => {
      if (isWebSocketOpen(ws)) {
        sendMessage(ws, decoder.decode(chunk));
      }
    };

    stdout.on("data", sendChunk);
    stderr.on("data", sendChunk);

    await new Promise<void>((resolve) => {
      bufferStream.on("end", resolve);
    });
  } catch (error: any) {
    sendError(ws, `Falha ao carregar logs recentes: ${error.message}`);
  }
};

export const startLiveLogsStream = async (
  connection: TerminalConnection
): Promise<void> => {
  try {
    const stream = (await connection.container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 0,
    })) as Readable;

    connection.logsStream = stream;

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    connection.container.modem.demuxStream(stream, stdout, stderr);

    const sendChunk = (chunk: Buffer) => {
      if (isWebSocketOpen(connection.ws)) {
        sendMessage(connection.ws, decoder.decode(chunk));
      }
    };

    stdout.on("data", sendChunk);
    stderr.on("data", sendChunk);

    // Monitor container stop events
    connection.container.wait().then(() => {
      if (isWebSocketOpen(connection.ws)) {
        sendStatus(connection.ws, "Bot parado - Aguardando reinicialização...");
        connection.isRunning = false;
        // Don't close connection, start monitoring for restart
        startContainerMonitoring(connection);
      }
    });

    stream.on("error", (error) => {
      sendError(connection.ws, `Falha ao ler logs: ${error.message}`);
    });
  } catch (error: any) {
    sendError(
      connection.ws,
      `Falha ao iniciar stream de logs: ${error.message}`
    );
  }
};

export const startContainerMonitoring = async (
  connection: TerminalConnection
): Promise<void> => {
  try {
    const docker = new Docker();
    const containerId = connection.container.id;

    const eventsStream = (await docker.getEvents({
      filters: { container: [containerId] },
    })) as Readable;

    connection.eventsStream = eventsStream;

    eventsStream.on("data", async (chunk: Buffer) => {
      try {
        const event = JSON.parse(chunk.toString());
        const action = event.Action || event.status;

        if (action === "start" && !connection.isRunning) {
          sendStatus(connection.ws, "Bot iniciado - Conectando aos logs...");
          connection.isRunning = true;

          // Stop events monitoring and start logs streaming
          if (connection.eventsStream) {
            connection.eventsStream.destroy();
            connection.eventsStream = undefined;
          }

          await startLiveLogsStream(connection);
        } else if (action === "die" || action === "stop") {
          connection.isRunning = false;
          sendStatus(
            connection.ws,
            "Bot parado - Aguardando reinicialização..."
          );
        }
      } catch (error) {
        // Silently handle JSON parse errors
      }
    });

    eventsStream.on("error", (error) => {
      console.error(`Events stream error for bot ${connection.botId}:`, error);
    });
  } catch (error: any) {
    sendError(connection.ws, `Falha ao monitorar container: ${error.message}`);
  }
};
