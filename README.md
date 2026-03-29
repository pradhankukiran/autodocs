<p align="center">
  <img src="https://img.icons8.com/fluency/96/api-settings.png" alt="autodocs logo" width="80" />
</p>

<h1 align="center">autodocs</h1>

<p align="center">
  <strong>Point it at a repo. Get production-ready API docs.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#deployment">Deployment</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/pradhankukiran/autodocs/blob/main/LICENSE"><img src="https://img.shields.io/github/license/pradhankukiran/autodocs?style=flat-square&color=blue" alt="License"></a>
  <a href="https://github.com/pradhankukiran/autodocs/issues"><img src="https://img.shields.io/github/issues/pradhankukiran/autodocs?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/pradhankukiran/autodocs/stargazers"><img src="https://img.shields.io/github/stars/pradhankukiran/autodocs?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/PostgreSQL-15-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/OpenAI_SDK-4-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI SDK">
  <img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Zod-3-3E67B1?style=flat-square&logo=zod&logoColor=white" alt="Zod">
</p>

---

**autodocs** automatically generates comprehensive API documentation from your source code using LLMs. It clones your repo, detects your framework, parses routes, and produces endpoint docs, code examples, and an interactive OpenAPI playground -- all published to Wiki.js.

## Features

- **Multi-framework support** -- Express, Fastify, and Koa route detection out of the box
- **LLM-powered generation** -- uses Cerebras, Groq, or OpenRouter with automatic provider fallback
- **Interactive API playground** -- choose from Scalar, Swagger UI, Redoc, RapiDoc, or Stoplight Elements
- **Code examples** -- auto-generated in 15+ languages (JS, Python, cURL, Go, Rust, Java, C#, PHP, Ruby...)
- **Resume on failure** -- checkpoint-based generation resumes from where it left off
- **Wiki.js publishing** -- docs are published as styled wiki pages with custom CSS
- **OpenAPI spec generation** -- full OpenAPI 3.0 spec built from parsed routes
- **Background job queue** -- non-blocking generation with real-time SSE progress streaming
- **SQLite + Postgres** -- zero-config SQLite for dev, Postgres for production
- **Split deployment** -- run API server and doc worker as separate processes

## Quick Start

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/pradhankukiran/autodocs.git
cd autodocs
npm install
```

### 2. Start infrastructure

```bash
cp .env.example .env
# Edit .env -- add at least one LLM provider API key (CEREBRAS_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY)

npm run infra:up          # starts Postgres + Wiki.js
```

### 3. Run the app

```bash
npm run dev               # starts backend (port 4000) + frontend (port 5173)
```

### 4. Generate docs

```bash
# Ingest a repo
curl -X POST http://localhost:4000/api/repos \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/expressjs/express"}'

# Generate documentation
curl -X POST http://localhost:4000/api/docs/generate \
  -H "Content-Type: application/json" \
  -d '{"repoId": "<repoId from above>", "provider": "cerebras"}'
```

Or just use the web UI at `http://localhost:5173`.

## Architecture

```
                    +------------------+
                    |   React Frontend |
                    |   (Vite + TW4)   |
                    +--------+---------+
                             |
                    +--------v---------+
                    |  Express 5 API   |
                    |  /api/repos      |
                    |  /api/docs       |
                    |  /api/providers  |
                    +---+---------+----+
                        |         |
              +---------+    +----v--------+
              |  SQLite  |    |  Postgres   |
              |  (dev)   |    |  (prod)     |
              +----------+    +------+------+
                                     |
                    +----------------v-------+
                    |     Doc Job Runner     |
                    |  (background worker)   |
                    +--+--+-----------+------+
                       |  |           |
            +----------+  |     +-----v------+
            | LLM APIs |  |     |  Wiki.js   |
            | Cerebras |  |     |  (publish)  |
            | Groq     |  |     +------------+
            | OpenRouter|  |
            +-----------+  |
                     +-----v------+
                     |  OpenAPI   |
                     |  Spec Gen  |
                     +------------+
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS 4, TanStack Query, React Router |
| Backend | Node.js, Express 5, TypeScript, Zod |
| LLM | OpenAI SDK (Cerebras, Groq, OpenRouter) |
| Database | SQLite (better-sqlite3) / PostgreSQL |
| Parsing | Babel AST traversal for route extraction |
| Wiki | Wiki.js via GraphQL API |
| Infra | Docker Compose, Caddy reverse proxy |

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the full list.

| Variable | Description | Default |
|----------|-------------|---------|
| `CEREBRAS_API_KEY` | Cerebras API key | -- |
| `GROQ_API_KEY` | Groq API key | -- |
| `OPENROUTER_API_KEY` | OpenRouter API key | -- |
| `DEFAULT_LLM_PROVIDER` | Preferred provider | `cerebras` |
| `ADMIN_API_KEY` | Protects admin endpoints | -- |
| `WIKI_URL` | Wiki.js instance URL | `http://localhost:3000` |
| `WIKI_API_TOKEN` | Wiki.js API token | -- |
| `APP_DATABASE_URL` | Postgres connection string | -- (uses SQLite) |
| `AUTODOCS_PROCESS_MODE` | `all`, `server`, or `worker` | `all` |
| `CORS_ORIGINS` | Comma-separated allowed origins | -- |

## API Reference

### Repos

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/repos` | Ingest a repository |
| `GET` | `/api/repos` | List ingested repos |
| `GET` | `/api/repos/:id` | Get repo details with routes |

### Documentation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/docs/generate` | Start doc generation job |
| `POST` | `/api/docs/resume/:repoId` | Resume a failed job |
| `GET` | `/api/docs/jobs/:jobId` | Get job status |
| `GET` | `/api/docs/jobs/:jobId/events` | SSE progress stream |
| `GET` | `/api/docs/openapi/:repoId` | Get generated OpenAPI spec |

### Providers & Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/providers` | List LLM providers |
| `GET` | `/api/providers/settings` | Get app settings |
| `PUT` | `/api/providers/settings` | Update settings |
| `GET` | `/api/providers/wiki-status` | Check Wiki.js connection |

## Deployment

### Docker Compose (EC2)

A production-ready Docker Compose setup with Caddy TLS is in [`deploy/ec2/`](deploy/ec2/).

```bash
cd deploy/ec2
cp .env.example .env
# Edit .env with your domain, API keys, and passwords
sudo bash setup_autodocs_ec2.sh
```

This provisions:
- PostgreSQL with separate autodocs database
- Wiki.js for doc publishing
- Backend API server + background worker
- Caddy with automatic HTTPS

See [`deploy/ec2/README.md`](deploy/ec2/README.md) for full instructions.

### Split Mode

Run the API server and doc worker as separate processes for better resource isolation:

```bash
# Server only (handles HTTP requests)
AUTODOCS_PROCESS_MODE=server npm start

# Worker only (processes doc generation jobs)
AUTODOCS_PROCESS_MODE=worker npm start
```

## Development

```bash
npm install                # install all workspaces
npm run infra:up           # start Postgres + Wiki.js
npm run dev                # start backend + frontend in watch mode

# Run tests
cd backend && npm test

# Database migrations (Postgres only)
npm run db:migrate:app
npm run db:status:app
```

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

[MIT](LICENSE)
