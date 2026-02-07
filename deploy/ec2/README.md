# EC2 Setup

Use the helper script to deploy `autodocs` on an EC2 host that already has other Docker apps.

## Run

```bash
cd deploy/ec2
chmod +x setup_autodocs_ec2.sh
./setup_autodocs_ec2.sh
```

By default it:
- creates/updates `.env`
- writes `docker-compose.override.yml` exposing:
  - backend on `4100`
  - wiki on `3100`
- starts `db`, `wiki`, `backend`
- creates two `cloudflared` systemd units:
  - `cloudflared-autodocs-api` -> `http://localhost:4100`
  - `cloudflared-autodocs-wiki` -> `http://localhost:3100`

## Required env values

In `deploy/ec2/.env`, set:
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `POSTGRES_PASSWORD`
- `WIKI_API_TOKEN`

At least one LLM key:
- `CEREBRAS_API_KEY` or `GROQ_API_KEY` or `OPENROUTER_API_KEY`

## Optional flags

Skip cloudflared unit setup:

```bash
SKIP_CLOUDFLARED=1 ./setup_autodocs_ec2.sh
```

Change exposed ports:

```bash
BACKEND_PUBLIC_PORT=5100 WIKI_PUBLIC_PORT=5101 ./setup_autodocs_ec2.sh
```
