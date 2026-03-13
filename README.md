# cvkit

```text
 ██████╗██╗   ██╗██╗  ██╗██╗████████╗
██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝
██║     ██║   ██║█████╔╝ ██║   ██║
██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║
╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║
 ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝
```

`cvkit` is a TypeScript CLI for computer vision engineers. Phase 0 provides the initial terminal experience, image inspection, local config storage, packaging, and CI.

## Install

```bash
npm install -g cvkit
```

For local development:

```bash
npm install
npm run dev
```

## Quick Start

```bash
cvkit
cvkit inspect ./sample.png
cvkit config set OPENAI_API_KEY=sk-example
cvkit config list
```

## Commands

| Command | Description |
|---|---|
| `cvkit` | Shows the splash screen and continues to help after Enter |
| `cvkit --help` | Shows help |
| `cvkit --version` | Shows the package version |
| `cvkit inspect <image>` | Prints image metadata via `sharp` |
| `cvkit config set KEY=VALUE` | Persists a config value to the user config file |
| `cvkit config list` | Lists config values and masks secrets |

## Config

`cvkit` stores configuration in:

- Windows: `%USERPROFILE%\.cvkit\config.json`
- macOS/Linux: `~/.cvkit/config.json`

Example:

```bash
cvkit config set MODEL=gpt-5.4
cvkit config set OPENAI_API_KEY=sk-example
cvkit config list
```

## Development

```bash
npm run typecheck
npm run test
npm run build
```

## Roadmap

### Phase 0
- Foundation scaffold
- Splash banner
- `inspect`
- `config`
- npm packaging and CI

### Phase 1
- Dataset inspection
- Validation
- Splits
- Duplicate detection
- Statistics via Python workers

### Phase 2
- Annotation format conversion

### Phase 3
- AI vision assistant
- Future OpenAI integration will use the Responses API as the baseline for GPT-5-family commands

### Phase 4
- Inference engine

### Phase 5
- Augmentation studio

### Phase 6
- Agent mode

