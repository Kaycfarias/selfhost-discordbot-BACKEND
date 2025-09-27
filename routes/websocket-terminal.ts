import { terminalWSS } from "../websocket-servers";
import { IncomingMessage } from "http";
import { Socket } from "net";
import Docker from "dockerode";
import type { WebSocket } from "ws";
import { PassThrough, Readable } from "stream";

const docker = new Docker();
const decoder = new TextDecoder("utf-8");

terminalWSS.on("connection", async (ws: WebSocket, req) => {
  const botId = new URL(
    req.url || "",
    `http://${req.headers.host}`
  ).searchParams.get("botId");

  if (!botId) {
    ws.send("[Erro] botId não fornecido");
    return ws.close();
  }

  const container = docker.getContainer(`bot-${botId}-container`);

  try {
    const { State } = await container.inspect();
    const isRunning = State.Running;

    await sendRecentLogs(container, ws);

    if (!isRunning) {
      ws.send("[Bot parado]");
      return ws.close();
    }

    await streamLiveLogs(container, ws);
  } catch (err: any) {
    ws.send(`[Erro] Não foi possível acessar o container: ${err.message}`);
    ws.close();
  }
});

async function sendRecentLogs(container: Docker.Container, ws: WebSocket) {
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

  const sendChunk = (chunk: Buffer) => ws.send(decoder.decode(chunk));
  stdout.on("data", sendChunk);
  stderr.on("data", sendChunk);

  await new Promise<void>((resolve) => {
    bufferStream.on("end", resolve);
  });
}

async function streamLiveLogs(container: Docker.Container, ws: WebSocket) {
  const stream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 0,
  })) as Readable;

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  container.modem.demuxStream(stream, stdout, stderr);

  const sendChunk = (chunk: Buffer) => ws.send(decoder.decode(chunk));
  stdout.on("data", sendChunk);
  stderr.on("data", sendChunk);

  container.wait().then(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send("[Bot parado]\n\r\n\r\n");
      ws.close();
    }
  });

  const cleanup = () => {
    stream.destroy?.();
    ws.close();
  };

  stream.on("error", (err) => {
    ws.send(`[Erro] Falha ao ler logs: ${err.message}`);
    ws.close();
  });

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

export function handleTerminalUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer
) {
  terminalWSS.handleUpgrade(req, socket, head, (ws) => {
    terminalWSS.emit("connection", ws, req);
  });
}
