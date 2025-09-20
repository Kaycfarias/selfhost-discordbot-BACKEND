import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import AdmZip from "adm-zip";
import { createAndRunBotContainer } from "./utils/dockerManager";

const router = Router();
const upload = multer({ dest: "uploads/" });

import type { Request, Response } from "express";

router.post(
  "/upload-bot",
  upload.single("BotZip"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file || !req.file.originalname.endsWith(".zip")) {
      res.status(400).send("Arquivo .zip obrigatório");
      return;
    }

    const botId = Date.now().toString();
    const botDir = path.resolve("bots", botId);

    try {
      await fs.mkdir(botDir, { recursive: true });

      const zipPath = path.resolve(req.file.path);

      // Extrair ZIP usando adm-zip
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();

      // Verificar se contém main.py e requirements.txt
      const hasMainPy = zipEntries.some(
        (entry) => entry.entryName === "main.py"
      );
      const hasRequirements = zipEntries.some(
        (entry) => entry.entryName === "requirements.txt"
      );

      if (!hasMainPy) {
        await fs.unlink(zipPath);
        res.status(400).json({ error: "O arquivo ZIP deve conter main.py" });
        return;
      }

      if (!hasRequirements) {
        await fs.unlink(zipPath);
        res
          .status(400)
          .json({ error: "O arquivo ZIP deve conter requirements.txt" });
        return;
      }

      zip.extractAllTo(botDir, true);

      await fs.unlink(zipPath);
      console.log("Respondendo com sucesso");
      await createAndRunBotContainer(botDir, botId);
      res.status(200).json({ message: "Upload e extração concluídos", botId });
    } catch (err: any) {
      console.error("Erro no upload do bot:", err);

      // Limpar arquivos em caso de erro
      try {
        await fs.rm(botDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error("Erro ao limpar diretório:", cleanupErr);
      }

      if (err.message.includes("Docker") || err.message.includes("container")) {
        res.status(503).json({ error: "Erro no Docker: " + err.message });
      } else {
        res
          .status(500)
          .json({ error: "Erro ao processar bot: " + err.message });
      }
    }
  }
);

export default router;
