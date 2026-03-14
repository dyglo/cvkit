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

## Roadmap

- Phase 0: scaffold, splash screen, inspect, config
- Phase 1+: future expansion beyond the verified baseline

## License

MIT
