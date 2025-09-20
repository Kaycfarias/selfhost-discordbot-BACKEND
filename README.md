# Selfhost Discord Bot API

API Backend para gerenciamento de Discord Bots self-hosted usando Docker + TypeScript + Bun

## 🚀 Tecnologias

- **Bun** - Runtime JavaScript rápido
- **TypeScript** - Tipagem estática
- **Express** - Framework web
- **Docker** - Containerização
- **WebSocket** - Comunicação em tempo real

## 📦 Instalação

```bash
# Instalar dependências
bun install
```

## 🛠️ Scripts Disponíveis

```bash
# Desenvolvimento com hot reload
bun run dev

# Executar em produção  
bun run start

# Build para produção
bun run build

# Verificar tipos TypeScript
bun run type-check
```

## 🌐 Endpoints

### REST API
- `GET /api/list-bots` - Lista todos os bots
- `POST /api/upload-bot` - Upload de um novo bot

### WebSocket
- `/ws/terminal` - Terminal interativo dos containers
- `/ws/metrics` - Métricas em tempo real dos containers

## 🏗️ Estrutura do Projeto

```
├── server.ts              # Servidor principal
├── websocket-servers.ts   # Configuração WebSocket
├── routes/
│   ├── list-bots.ts      # Listagem de bots
│   ├── upload-bot.ts     # Upload de bots  
│   ├── websocket-*.ts    # Handlers WebSocket
│   └── utils/
│       └── dockerManager.ts  # Gerenciamento Docker
```

## 🔧 Configuração

O projeto está configurado para usar Bun com TypeScript. O `tsconfig.json` está otimizado para desenvolvimento moderno com:

- Módulos ESNext
- Resolução de bundler
- Strict mode habilitado
- Path aliases configurados

## 📝 Desenvolvimento

Para desenvolver:

1. Clone o repositório
2. Execute `bun install` 
3. Execute `bun run dev` para modo desenvolvimento
4. A API estará rodando em `http://localhost:3001`

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
