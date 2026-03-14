# cvkit

```text
 ██████╗██╗   ██╗██╗  ██╗██╗████████╗
██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝
██║     ██║   ██║█████╔╝ ██║   ██║
██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║
╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║
 ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝
```

Computer Vision Toolkit for terminal workflows.

## Install

```bash
npm install -g cvkit
```

## Quick start

```bash
cvkit
cvkit inspect ./test/fixtures/sample.jpg
cvkit config set OPENAI_API_KEY=sk-...
```

## AI loop

`cvkit` now supports natural-language prompts in the REPL. Direct commands still work as before, but non-command input is routed through the OpenAI Responses API with tool calling over the local workspace.

Examples:

```text
find all images that do not have labels
how many class 0 annotations are in this dataset?
read labels/frame_001.txt
```

AI writes are gated. If the model wants to call `write_file` or `edit_file`, `cvkit` asks for a `y/n` confirmation before mutating the workspace.

## Command reference

| Command | Description |
| --- | --- |
| `cvkit` | Show the banner splash screen, then help |
| `cvkit --help` | Show help |
| `cvkit --version` | Show the current version |
| `cvkit inspect <imagePath>` | Inspect image metadata |
| `cvkit config set <KEY=VALUE>` | Save a config value |
| `cvkit config list` | List config values with secret masking |

## Configuration

Configuration lives in `~/.cvkit/config.json`.

```bash
cvkit config set OPENAI_API_KEY=sk-...
cvkit config set DEFAULT_MODEL=gpt-5-mini-2025-08-07
cvkit config list
```

AI credentials are resolved in this order:

1. `OPENAI_API_KEY` from `~/.cvkit/config.json`
2. `CVKIT_OPENAI_KEY` from the runtime environment or `.env`

Create a local `.env` from the example file when you want a shared runtime fallback without storing the key in user config:

```bash
cp .env.example .env
```

## HTTP server

The Cloud Run wrapper exposes a minimal HTTP API:

- `GET /health`
- `POST /v1/ai/respond`

The HTTP AI endpoint is intentionally read-only. It exposes `read_file`, `glob_files`, `grep_files`, `inspect_image`, and `list_dir`, but not `write_file` or `edit_file`.

Example:

```bash
curl http://localhost:8080/health
curl -X POST http://localhost:8080/v1/ai/respond \
  -H "content-type: application/json" \
  -d '{"input":"summarize the workspace"}'
```

## Docker

Build and run the HTTP wrapper locally:

```bash
npm run build
docker build -t cvkit .
docker run --rm -p 8080:8080 --env-file .env cvkit
```

For local development with Postgres:

```bash
docker compose up --build
```

## Cloud Run

Deploy the HTTP wrapper to Cloud Run with authenticated access and a Secret Manager-backed OpenAI key:

```bash
chmod +x deploy/cloud-run.sh
deploy/cloud-run.sh <project-id> <region> <openai-secret-name> [service-name] [secret-version]
```

## Roadmap

- Phase 0: scaffold, splash screen, inspect, config
- Phase 1+: future expansion beyond the verified baseline

## License

MIT
