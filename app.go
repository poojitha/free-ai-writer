package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	defaultOllamaHost  = "http://localhost:11434"
	defaultOllamaModel = "llama3.1:8b"
	defaultPrompt      = "Improve the writing quality of the following text. Fix grammar, " +
		"clarity, and flow, but preserve the original meaning. Return only the " +
		"improved text, with no preamble or explanation."
)

type ollamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. Sizes and centers the window
// to 90% of the primary screen.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	screens, err := runtime.ScreenGetAll(ctx)
	if err != nil || len(screens) == 0 {
		return
	}

	screen := screens[0]
	for _, s := range screens {
		if s.IsPrimary {
			screen = s
			break
		}
	}

	winW := int(float64(screen.Size.Width) * 0.9)
	winH := int(float64(screen.Size.Height) * 0.9)

	runtime.WindowSetSize(ctx, winW, winH)
	runtime.WindowCenter(ctx)
}

// ImproveText sends the given text to a local Ollama instance and returns
// an improved version. host, model, and prompt may be empty, in which case
// the defaults are used. prompt is prepended to the text as instructions.
func (a *App) ImproveText(text, host, model, prompt string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("nothing to improve")
	}

	host = strings.TrimSuffix(strings.TrimSpace(host), "/")
	if host == "" {
		host = defaultOllamaHost
	}
	if strings.TrimSpace(model) == "" {
		model = defaultOllamaModel
	}
	if strings.TrimSpace(prompt) == "" {
		prompt = defaultPrompt
	}

	fullPrompt := prompt + "\n\nText:\n " + text

	reqBody, err := json.Marshal(ollamaGenerateRequest{
		Model:  model,
		Prompt: fullPrompt,
		Stream: false,
	})
	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequestWithContext(a.ctx, http.MethodPost,
		host+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("could not reach Ollama (is it running?): %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(body))
	}

	var result ollamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return strings.TrimSpace(result.Response), nil
}

// OllamaSettings holds the configurable connection details and prompt for
// Ollama.
type OllamaSettings struct {
	Host   string `json:"host"`
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

// GetDefaultOllamaSettings returns the built-in default host/model/prompt,
// so the frontend doesn't need to duplicate them.
func (a *App) GetDefaultOllamaSettings() OllamaSettings {
	return OllamaSettings{Host: defaultOllamaHost, Model: defaultOllamaModel, Prompt: defaultPrompt}
}
