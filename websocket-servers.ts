import { WebSocketServer } from "ws";

export const terminalWSS = new WebSocketServer({ noServer: true });
export const metricsWSS = new WebSocketServer({ noServer: true });
