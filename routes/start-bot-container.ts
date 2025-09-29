import { Router } from "express";
import Docker from "dockerode";

const router = Router();
const docker = new Docker();

router.post("/start-bot", async (req, res) => {
  const botId = req.body?.botId as string;

  if (!botId) {
    return res.status(400).json({ error: "botId é obrigatório" });
  }
  console.log("Iniciando bot com ID:", botId);
  try {
    const container = docker.getContainer(`bot-${botId}-container`);
    const containerInfo = await container.inspect();

    if (!containerInfo) {
      return res.status(404).json({ error: "Container não encontrado" });
    }

    await container.start().then(() => {
      res.json({ message: "Bot iniciado com sucesso" });
      console.log("Bot iniciado com ID:", botId);
    });
  } catch (error: any) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Container não encontrado" });
    }
    if (error.statusCode === 304) {
      return res.json({ message: "Container já estava em execução" });
    }
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

export default router;
