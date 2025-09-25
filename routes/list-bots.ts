/**
 * @swagger
 * components:
 *   schemas:
 *     Bot:
 *       type: object
 *       properties:
 *         containerName:
 *           type: string
 *           description: Nome da imagem Docker
 *         botId:
 *           type: string
 *           description: ID único do bot
 *         state:
 *           type: string
 *           description: Estado atual do container
 *         status:
 *           type: string
 *           description: Status detalhado do container
 *         created:
 *           type: number
 *           description: Timestamp de criação
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Mensagem de erro
 * tags:
 *   - name: Bots
 *     description: Operações relacionadas aos Discord Bots
 */

import { Router } from "express";
import Docker from "dockerode";

const router = Router();
const docker = new Docker();

/**
 * @swagger
 * /api/list-bots:
 *   get:
 *     summary: Lista todos os bots do usuário
 *     tags: [Bots]
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário
 *     responses:
 *       200:
 *         description: Lista de bots retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   description: Número total de bots
 *                 bots:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       containerName:
 *                         type: string
 *                       botId:
 *                         type: string
 *                       state:
 *                         type: string
 *                       status:
 *                         type: string
 *                       created:
 *                         type: number
 *       400:
 *         description: userId é obrigatório
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Erro interno do servidor
 */
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
