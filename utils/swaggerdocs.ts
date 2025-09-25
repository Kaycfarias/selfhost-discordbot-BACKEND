import swaggerJSDoc from "swagger-jsdoc";

const swaggerDocs = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Discord Bot Hosting API",
      version: "1.0.0",
      description: "API para hospedagem e gerenciamento de Discord Bots",
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Servidor de desenvolvimento",
      },
    ],
  },
  apis: ["./routes/*.ts"],
});

export default swaggerDocs;
