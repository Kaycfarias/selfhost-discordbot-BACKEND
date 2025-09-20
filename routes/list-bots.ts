import { Router } from "express";
import Docker from "dockerode";

const router = Router();
const docker = new Docker();

router.get("/list-bots", async (req, res) => {
  const userId = req.query?.userId as string;

  if (!userId) {
    return res.status(400).json({ error: "userId é obrigatório" });
  }

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`userId=${userId}`],
      },
    });
    const bots = containers.map((container) => ({
      containerName: container.Image,
      botId: container.Labels.botId,
      state: container.State,
      status: container.Status,
      created: container.Created,
    }));

    res.json({ count: bots.length, bots });
  } catch (error) {
    console.error("Erro ao listar bots:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

export default router;
