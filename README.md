<p align="center">
  <img src="frontend/src/assets/hush-logo.png" alt="Hush Writer logo" width="160">
</p>

# Hush Writer

A distraction-free, AI-assisted writing tool for the desktop. Write in a rich-text editor, then have a local LLM (via [Ollama](https://ollama.com)) improve your text's grammar, clarity, and flow. Everything runs on your machine — no cloud services.

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
  ollama pull qwen2.5:3b
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
| Model       | `qwen2.5:3b`            |
| Prompt      | See below                |

The default prompt is:

> Improve the writing quality of the following text. Fix grammar, clarity, and flow, but preserve the original meaning. Return only the improved text, with no preamble or explanation.

Your text is appended after the prompt, following a `Text:` line. Settings are saved automatically and persist across restarts. The host and model defaults are defined in `app.go`; the default prompts in `frontend/src/settings.js`.

## Project structure

```
main.go               Wails app setup and window options
app.go                Backend: Ollama client and settings defaults
frontend/src/App.jsx  UI: editor, Improve and Settings tabs
frontend/wailsjs/     Auto-generated Go↔JS bindings (do not edit)
build/                Platform build assets; output in build/bin/
```

## License

Hush Writer is released under the [MIT License](LICENSE).

It bundles [TinyMCE](https://www.tiny.cloud), which is licensed under the GPL v2 or later, so builds of the app that include it are distributed under the GPL's terms as well.
