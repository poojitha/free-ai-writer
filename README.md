# Write

A desktop writing app with AI-assisted editing. Write in a rich-text editor, then have a local LLM (via [Ollama](https://ollama.com)) improve your text's grammar, clarity, and flow. Everything runs on your machine — no cloud services.

Built with [Wails v2](https://wails.io) (Go backend) and React + [TinyMCE](https://www.tiny.cloud) (frontend).

## Features

- Rich-text editor (headings, bold/italic, alignment, lists, links, images, source view)
- One-click "Improve with Ollama" that rewrites your text while preserving its meaning
- Configurable Ollama host, model, and prompt, saved between sessions

## Requirements

- [Go](https://go.dev) 1.26+
- [Node.js](https://nodejs.org) and npm
- [Wails CLI](https://wails.io/docs/gettingstarted/installation): `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- [Ollama](https://ollama.com) running locally, with a model pulled:

  ```sh
  ollama pull llama3.1:8b
  ```

## Development

Run the app in development mode with hot reload:

```sh
wails dev
```

This also serves a dev URL you can open in a browser to call the Go methods from devtools.

After changing exported methods on the `App` struct in `app.go`, regenerate the frontend bindings:

```sh
wails generate module
```

## Building

```sh
wails build
```

The executable is written to `build/bin/`.

## Usage

1. Make sure Ollama is running (`ollama serve`).
2. Write or paste text into the editor.
3. Click **Improve with Ollama** in the side panel. The improved text appears below the button.

Note: text is sent to the model as plain text, so the improved result does not keep editor formatting.

## Configuration

Open the **Settings** tab to change:

| Setting     | Default                  |
|-------------|--------------------------|
| Ollama host | `http://localhost:11434` |
| Model       | `llama3.1:8b`            |
| Prompt      | Instructions to fix grammar, clarity, and flow while preserving meaning |

Settings are saved automatically and persist across restarts.

## Project structure

```
main.go               Wails app setup and window options
app.go                Backend: Ollama client and settings defaults
frontend/src/App.jsx  UI: editor, Improve and Settings tabs
frontend/wailsjs/     Auto-generated Go↔JS bindings (do not edit)
build/                Platform build assets; output in build/bin/
```
