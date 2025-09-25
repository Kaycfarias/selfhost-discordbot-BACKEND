import path from "path";
import fs from "fs/promises";
import Docker from "dockerode";

const docker = new Docker();
const dockerfileContent = `
FROM python:3-slim

WORKDIR /app
RUN apt-get update && apt-get install -y curl
RUN curl -I https://pypi.org/simple/
COPY . .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

CMD ["python", "-u", "main.py"]
`;

export async function createAndRunBotContainer(botDir: string, botId: string) {
  try {
    await fs.writeFile(path.join(botDir, "Dockerfile"), dockerfileContent);

    const imageName = `bot-${botId}`;
    const containerName = `bot-${botId}-container`;

    const tarStream = await docker.buildImage(
      {
        context: botDir,
        src: await fs.readdir(botDir),
      },
      { t: imageName }
    );

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(tarStream, (err, output) => {
        if (err)
          return reject(new Error(`Erro ao construir imagem: ${err.message}`));
        console.log("Imagem construída com sucesso.");
        resolve();
      });
    });

    const container = await docker.createContainer({
      Labels: { userId: "123", botId: `${botId}` },
      name: containerName,
      Image: imageName,
      HostConfig: {
        Memory: 256 * 1024 * 1024,
        NanoCpus: 0.5 * 1e9,
      },
    });

    await container.start();
    console.log(`Container ${containerName} iniciado.`);
  } catch (error: any) {
    console.error(`Erro no Docker para bot ${botId}:`, error.message);
    throw new Error(`Falha ao criar/iniciar container: ${error.message}`);
  }
}
