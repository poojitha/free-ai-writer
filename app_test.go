package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func newTestApp() *App {
	return &App{ctx: context.Background()}
}

// fakeOllama serves /api/generate, records the last request, and replies
// with the given status and body.
func fakeOllama(t *testing.T, status int, body string) (*httptest.Server, *ollamaGenerateRequest) {
	t.Helper()
	var got ollamaGenerateRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decoding request: %v", err)
		}
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func ollamaReply(text string) string {
	b, _ := json.Marshal(ollamaGenerateResponse{Response: text})
	return string(b)
}

func TestImproveTextSendsPromptAndText(t *testing.T) {
	srv, got := fakeOllama(t, http.StatusOK, ollamaReply("  Cats are nice.  "))

	improved, err := newTestApp().ImproveText("cats is nice", srv.URL+"/", "test-model", "Fix it.")
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
	if got.Model != "test-model" || got.Stream {
		t.Errorf("request = %+v", got)
	}
	if got.Prompt != "Fix it.\n\nText:\n cats is nice" {
		t.Errorf("prompt = %q", got.Prompt)
	}
}

func TestImproveTextUsesDefaultModelAndPrompt(t *testing.T) {
	srv, got := fakeOllama(t, http.StatusOK, ollamaReply("ok"))

	if _, err := newTestApp().ImproveText("text", srv.URL, " ", ""); err != nil {
		t.Fatal(err)
	}
	if got.Model != defaultOllamaModel {
		t.Errorf("model = %q, want %q", got.Model, defaultOllamaModel)
	}
	if !strings.HasPrefix(got.Prompt, defaultPrompt) {
		t.Errorf("prompt = %q, want it to start with the default prompt", got.Prompt)
	}
}

func TestImproveTextStripsPreamble(t *testing.T) {
	srv, _ := fakeOllama(t, http.StatusOK, ollamaReply("Here is the improved text:\n\nCats are nice."))

	improved, err := newTestApp().ImproveText("cats is nice", srv.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
}

func TestImproveTextErrors(t *testing.T) {
	t.Run("empty text", func(t *testing.T) {
		if _, err := newTestApp().ImproveText("  \n", "http://unused", "", ""); err == nil {
			t.Error("want an error")
		}
	})

	t.Run("non-200 status", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusNotFound, `{"error":"model not found"}`)
		_, err := newTestApp().ImproveText("text", srv.URL, "", "")
		if err == nil || !strings.Contains(err.Error(), "404") || !strings.Contains(err.Error(), "model not found") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("empty response", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusOK, ollamaReply("Here is the improved text:"))
		if _, err := newTestApp().ImproveText("text", srv.URL, "", ""); err == nil {
			t.Error("want an error")
		}
	})

	t.Run("unreachable host", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusOK, "")
		url := srv.URL
		srv.Close()
		_, err := newTestApp().ImproveText("text", url, "", "")
		if err == nil || !strings.Contains(err.Error(), "could not reach Ollama") {
			t.Errorf("err = %v", err)
		}
	})
}

func TestCleanResponse(t *testing.T) {
	cases := []struct{ in, want string }{
		{"We went to the store.", "We went to the store."},
		{"Here is the improved text:\n\nWe went to the store.", "We went to the store."},
		{"Sure! Here's a revised version:\nWe went.", "We went."},
		{"  Certainly, here is the rewritten text:  \n  Line one\nLine two ", "Line one\nLine two"},
		{"I think the text is incomplete. However, here's the revised text:\n\nCats are nice.", "Cats are nice."},
		{"Here are the changes I made:\n\"We went.\"", "We went."},
		{"Here is the improved text:", ""},
		// Not preambles: a colon mid-sentence, or a "here is" line too far down.
		{"Here is a sentence about cats: they purr.", "Here is a sentence about cats: they purr."},
		{"One.\n\nTwo.\n\nThree.\n\nHere is a list:\nitem", "One.\n\nTwo.\n\nThree.\n\nHere is a list:\nitem"},
		// Inner quotes are kept; only quotes wrapping the whole reply go.
		{`He said "hi" and "bye".`, `He said "hi" and "bye".`},
	}
	for _, c := range cases {
		if got := cleanResponse(c.in); got != c.want {
			t.Errorf("cleanResponse(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestGetDefaultOllamaSettings(t *testing.T) {
	s := newTestApp().GetDefaultOllamaSettings()
	if s.Host != defaultOllamaHost || s.Model != defaultOllamaModel || s.Prompt != defaultPrompt {
		t.Errorf("settings = %+v", s)
	}
	for id, p := range s.ActionPrompts {
		if strings.TrimSpace(p) == "" {
			t.Errorf("action %q has an empty default prompt", id)
		}
	}
}

// Every frontend action except "improve" (which uses defaultPrompt) needs a
// default prompt here, and vice versa. The ids are read from settings.js,
// where they're written as `id: '<id>'`.
func TestActionPromptsMatchFrontendActions(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("frontend", "src", "settings.js"))
	if err != nil {
		t.Fatal(err)
	}
	var frontend []string
	for _, m := range regexp.MustCompile(`id: '(\w+)'`).FindAllStringSubmatch(string(src), -1) {
		frontend = append(frontend, m[1])
	}
	var backend []string
	for id := range defaultActionPrompts {
		backend = append(backend, id)
	}
	sort.Strings(frontend)
	sort.Strings(backend)
	if strings.Join(frontend, ",") != strings.Join(backend, ",") {
		t.Errorf("frontend action ids %v != Go defaultActionPrompts keys %v", frontend, backend)
	}
}

func TestSaveDocumentWritesToGivenPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "essay.html")
	content := "<p>Hello</p>"

	got, err := newTestApp().SaveDocument(path, content)
	if err != nil {
		t.Fatal(err)
	}
	if got != path {
		t.Errorf("returned path = %q, want %q", got, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != content {
		t.Errorf("file = %q, want %q", data, content)
	}
}

func TestSaveDocumentReportsWriteErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-dir", "essay.html")
	if _, err := newTestApp().SaveDocument(path, "x"); err == nil {
		t.Error("want an error")
	}
}
