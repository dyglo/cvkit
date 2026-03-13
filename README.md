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
cvkit inspect ./test/fixtures/sample.png
cvkit config set OPENAI_API_KEY=sk-...
```

## Command reference

| Command | Description |
| --- | --- |
| `cvkit` | Show the banner splash screen, then help |
| `cvkit inspect <imagePath>` | Inspect image metadata |
| `cvkit config set <KEY=VALUE>` | Save a config value |
| `cvkit config list` | List config values with secret masking |
| `cvkit dataset inspect <dir>` | Inspect dataset layout and class coverage |
| `cvkit dataset validate <dir>` | Validate YOLO, COCO, or Pascal VOC annotations |
| `cvkit dataset split <dir>` | Stratified dataset split |
| `cvkit dataset dupes <dir>` | Detect near-duplicate images |
| `cvkit dataset stats <dir>` | Compute image statistics via Python worker |

## Configuration

Configuration lives in `~/.cvkit/config.json`.

```bash
cvkit config set OPENAI_API_KEY=sk-...
cvkit config set DEFAULT_MODEL=gpt-5-mini-2025-08-07
cvkit config list
```

## Roadmap

- Phase 0: scaffold, splash screen, inspect, config
- Phase 1: dataset inspect, validate, split, dupes, stats
- Phase 2: annotation conversion utilities
- Phase 3: OpenAI-powered CV assistance
- Phase 4: inference and benchmarking helpers
- Phase 5: augmentation and preprocessing workflows
- Phase 6: agentic computer vision pipelines

## License

MIT
