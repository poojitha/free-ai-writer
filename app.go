package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	defaultOllamaHost  = "http://localhost:11434"
	defaultOllamaModel = "qwen2.5:3b"
)

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

// ImproveText sends the given text to the AI provider in cfg and returns an
// improved version. prompt is prepended to the text as instructions (the
// frontend owns the prompts); empty cfg fields fall back to the defaults.
func (a *App) ImproveText(text, prompt string, cfg AIConfig) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("nothing to improve")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", fmt.Errorf("no prompt given")
	}

	id := strings.TrimSpace(cfg.Provider)
	if id == "" {
		id = "ollama"
	}
	p, ok := providers[id]
	if !ok {
		return "", fmt.Errorf("unknown AI provider %q", cfg.Provider)
	}

	host := strings.TrimSuffix(strings.TrimSpace(cfg.Host), "/")
	if host == "" {
		host = p.defaults.Host
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = p.defaults.Model
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if host == "" || model == "" {
		return "", fmt.Errorf("enter the API URL and model in Settings")
	}
	if p.needsKey && apiKey == "" {
		return "", fmt.Errorf("add your %s API key in Settings", p.name)
	}
	reply, err := p.generate(a.ctx, host, model, apiKey, prompt+"\n\nText:\n "+text)
	var unreachable errUnreachable
	if errors.As(err, &unreachable) {
		hint := ""
		if id == "ollama" {
			hint = " (is it running?)"
		}
		return "", fmt.Errorf("could not reach %s%s: %w", p.name, hint, unreachable.err)
	}
	if err != nil {
		return "", fmt.Errorf("%s %w", p.name, err)
	}

	improved := cleanResponse(reply)
	if improved == "" {
		return "", fmt.Errorf("%s returned an empty response", p.name)
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

// DefaultSettings are each provider's default host/model. The default prompts
// live in the frontend (frontend/src/settings.js).
type DefaultSettings struct {
	Providers map[string]ProviderDefaults `json:"providers"`
}

// GetDefaultSettings returns the built-in defaults, so the frontend doesn't
// need to duplicate them.
func (a *App) GetDefaultSettings() DefaultSettings {
	defaults := map[string]ProviderDefaults{}
	for id, p := range providers {
		defaults[id] = p.defaults
	}
	return DefaultSettings{Providers: defaults}
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
