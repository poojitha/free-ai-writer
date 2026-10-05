package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	defaultOllamaHost  = "http://localhost:11434"
	defaultOllamaModel = "llama3.1:8b"
	// Used both when pressing Enter and by the "Improve writing" action.
	defaultPrompt = "Improve the following text so it is clear and reads smoothly. " +
		"Fix grammar, simplify confusing or awkward phrasing, and improve flow, " +
		"while keeping the original meaning and voice. Return only the improved " +
		"text, with no preamble or explanation."
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

	improved := cleanResponse(result.Response)
	if improved == "" {
		return "", fmt.Errorf("ollama returned an empty response")
	}
	return improved, nil
}

// preamblePattern matches a lead-in line such as "Here is the improved
// text:" or "Sure! Here's a revised version:" that models add despite being
// told not to. It must end the line with a colon, so ordinary sentences like
// "Here is a cat: it purrs." don't match.
var preamblePattern = regexp.MustCompile(`(?i)\bhere(?:'s| is| are)\b.*:\s*$`)

// preambleSearchLines is how far into the reply a preamble line is looked
// for. Models sometimes chat for a line or two before it ("I think the text
// is incomplete. However, here's the revised text:").
const preambleSearchLines = 4

// cleanResponse trims the model's reply, drops everything up to and
// including a preamble line, and strips quotes wrapping the whole result.
func cleanResponse(s string) string {
	s = strings.TrimSpace(s)
	lines := strings.Split(s, "\n")
	for i := 0; i < len(lines) && i < preambleSearchLines; i++ {
		if preamblePattern.MatchString(lines[i]) {
			s = strings.TrimSpace(strings.Join(lines[i+1:], "\n"))
			break
		}
	}
	if len(s) >= 2 && strings.HasPrefix(s, `"`) && strings.HasSuffix(s, `"`) &&
		!strings.Contains(s[1:len(s)-1], `"`) {
		s = strings.TrimSpace(s[1 : len(s)-1])
	}
	return s
}

const returnOnly = " Return only the rewritten text, with no preamble or explanation."

// defaultActionPrompts are the prompts for the suggestion bar actions, keyed
// by the action ids the frontend uses. The "improve" action uses
// defaultPrompt instead.
var defaultActionPrompts = map[string]string{
	"concise": "Rewrite the following text to be more concise. Remove filler and redundancy but keep every idea." + returnOnly,
	"tone":    "Rewrite the following text with a warmer, more natural and engaging tone, keeping its meaning." + returnOnly,
	"expand":  "Expand the following text with more detail, examples, or depth, in the same voice and style." + returnOnly,
	"grammar": "Fix the grammar, spelling, and punctuation of the following text. Change nothing else." + returnOnly,
}

// OllamaSettings holds the configurable connection details and prompts for
// Ollama. Prompt is used when pressing Enter; ActionPrompts by the
// suggestion bar actions.
type OllamaSettings struct {
	Host   string `json:"host"`
	Model  string `json:"model"`
	Prompt string `json:"prompt"`

	ActionPrompts map[string]string `json:"actionPrompts"`
}

// GetDefaultOllamaSettings returns the built-in default host/model/prompts,
// so the frontend doesn't need to duplicate them.
func (a *App) GetDefaultOllamaSettings() OllamaSettings {
	return OllamaSettings{
		Host:          defaultOllamaHost,
		Model:         defaultOllamaModel,
		Prompt:        defaultPrompt,
		ActionPrompts: defaultActionPrompts,
	}
}

// Document is a file opened from disk. Data is the raw file contents (sent
// to the frontend as base64); the frontend converts it to editor HTML based
// on the file's extension.
type Document struct {
	Path string `json:"path"`
	Data []byte `json:"data"`
}

// documentExtensions are the formats the frontend can read and write. The
// first is the default for new files.
var documentExtensions = []string{".docx", ".txt", ".html", ".htm"}

// saveFilters lists Word first: on Windows, Wails makes the first filter's
// extension the dialog's default, and Windows switches it to match whichever
// type the user picks.
var saveFilters = []runtime.FileFilter{
	{DisplayName: "Word document (*.docx)", Pattern: "*.docx"},
	{DisplayName: "Plain text (*.txt)", Pattern: "*.txt"},
	{DisplayName: "Web page (*.html)", Pattern: "*.html;*.htm"},
}

var openFilters = append([]runtime.FileFilter{
	{DisplayName: "All documents (*.docx, *.txt, *.html)", Pattern: "*.docx;*.txt;*.html;*.htm"},
}, saveFilters...)

// OpenDocument shows an open dialog and returns the chosen file. If the user
// cancels, the returned Document has an empty Path.
func (a *App) OpenDocument() (Document, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open document",
		Filters: openFilters,
	})
	if err != nil || path == "" {
		return Document{}, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return Document{}, err
	}
	return Document{Path: path, Data: data}, nil
}

// ChooseSavePath shows a save dialog, starting from currentPath's folder and
// name if there is one, and returns the chosen path. The format is picked by
// its extension. Returns "" if the user cancelled.
func (a *App) ChooseSavePath(currentPath string) (string, error) {
	options := runtime.SaveDialogOptions{
		Title:           "Save document",
		DefaultFilename: "Untitled",
		Filters:         saveFilters,
	}
	if currentPath != "" {
		options.DefaultDirectory = filepath.Dir(currentPath)
		options.DefaultFilename = strings.TrimSuffix(filepath.Base(currentPath), filepath.Ext(currentPath))
	}

	path, err := runtime.SaveFileDialog(a.ctx, options)
	if err != nil || path == "" {
		return "", err
	}
	return withDocumentExtension(path), nil
}

// withDocumentExtension adds the default extension (.docx) unless path
// already ends in a supported one.
func withDocumentExtension(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	for _, e := range documentExtensions {
		if ext == e {
			return path
		}
	}
	return path + documentExtensions[0]
}

// WriteDocument writes data (already in the format matching path's
// extension) to path.
func (a *App) WriteDocument(path string, data []byte) error {
	return os.WriteFile(path, data, 0o644)
}
