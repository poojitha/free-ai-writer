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

	improved, err := newTestApp().ImproveText("cats is nice", "Fix it.", AIConfig{Host: srv.URL + "/", Model: "test-model"})
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

func TestImproveTextUsesDefaultModel(t *testing.T) {
	srv, got := fakeOllama(t, http.StatusOK, ollamaReply("ok"))

	if _, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Host: srv.URL, Model: " "}); err != nil {
		t.Fatal(err)
	}
	if got.Model != defaultOllamaModel {
		t.Errorf("model = %q, want %q", got.Model, defaultOllamaModel)
	}
}

func TestImproveTextRequiresPrompt(t *testing.T) {
	if _, err := newTestApp().ImproveText("text", "  ", AIConfig{Host: "http://unused"}); err == nil {
		t.Error("expected an error for an empty prompt")
	}
}

func TestImproveTextStripsPreamble(t *testing.T) {
	srv, _ := fakeOllama(t, http.StatusOK, ollamaReply("Here is the improved text:\n\nCats are nice."))

	improved, err := newTestApp().ImproveText("cats is nice", "Fix it.", AIConfig{Host: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
}

func TestImproveTextErrors(t *testing.T) {
	t.Run("empty text", func(t *testing.T) {
		if _, err := newTestApp().ImproveText("  \n", "", AIConfig{Host: "http://unused"}); err == nil {
			t.Error("want an error")
		}
	})

	t.Run("non-200 status", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusNotFound, `{"error":"model not found"}`)
		_, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Host: srv.URL})
		if err == nil || !strings.Contains(err.Error(), "404") || !strings.Contains(err.Error(), "model not found") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("empty response", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusOK, ollamaReply("Here is the improved text:"))
		if _, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Host: srv.URL}); err == nil {
			t.Error("want an error")
		}
	})

	t.Run("unreachable host", func(t *testing.T) {
		srv, _ := fakeOllama(t, http.StatusOK, "")
		url := srv.URL
		srv.Close()
		_, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Host: url})
		if err == nil || !strings.Contains(err.Error(), "could not reach Ollama") {
			t.Errorf("err = %v", err)
		}
	})
}

// fakeProvider serves path, records the request's headers and decoded JSON
// body, and replies with the given status and body.
func fakeProvider(t *testing.T, path string, status int, body string) (*httptest.Server, *http.Header, *map[string]any) {
	t.Helper()
	var header http.Header
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		header = r.Header.Clone()
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decoding request: %v", err)
		}
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &header, &got
}

// userMessage returns the content of the single user message in a
// chat-style request body.
func userMessage(t *testing.T, body map[string]any) string {
	t.Helper()
	msgs, _ := body["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("messages = %v", body["messages"])
	}
	m := msgs[0].(map[string]any)
	if m["role"] != "user" {
		t.Errorf("role = %v", m["role"])
	}
	content, _ := m["content"].(string)
	return content
}

func TestImproveTextOpenAI(t *testing.T) {
	srv, header, got := fakeProvider(t, "/v1/chat/completions", http.StatusOK,
		`{"choices":[{"message":{"role":"assistant","content":"Cats are nice."}}]}`)

	improved, err := newTestApp().ImproveText("cats is nice", "Fix it.",
		AIConfig{Provider: "openai", Host: srv.URL + "/v1", Model: "gpt-test", APIKey: " sk-1 "})
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
	if h := header.Get("Authorization"); h != "Bearer sk-1" {
		t.Errorf("Authorization = %q", h)
	}
	if (*got)["model"] != "gpt-test" {
		t.Errorf("model = %v", (*got)["model"])
	}
	if msg := userMessage(t, *got); msg != "Fix it.\n\nText:\n cats is nice" {
		t.Errorf("message = %q", msg)
	}
}

func TestImproveTextAnthropic(t *testing.T) {
	srv, header, got := fakeProvider(t, "/v1/messages", http.StatusOK,
		`{"content":[{"type":"text","text":"Cats "},{"type":"text","text":"are nice."}]}`)

	improved, err := newTestApp().ImproveText("cats is nice", "Fix it.",
		AIConfig{Provider: "anthropic", Host: srv.URL, APIKey: "key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
	if header.Get("x-api-key") != "key-1" || header.Get("anthropic-version") == "" {
		t.Errorf("headers = %v", *header)
	}
	if (*got)["model"] != providers["anthropic"].defaults.Model || (*got)["max_tokens"] == nil {
		t.Errorf("request = %v", *got)
	}
	if msg := userMessage(t, *got); msg != "Fix it.\n\nText:\n cats is nice" {
		t.Errorf("message = %q", msg)
	}
}

func TestImproveTextCustomProvider(t *testing.T) {
	srv, header, got := fakeProvider(t, "/api/v1/chat/completions", http.StatusOK,
		`{"choices":[{"message":{"role":"assistant","content":"Cats are nice."}}]}`)

	improved, err := newTestApp().ImproveText("cats is nice", "Fix it.",
		AIConfig{Provider: "custom", Host: srv.URL + "/api/v1/", Model: "my-model"})
	if err != nil {
		t.Fatal(err)
	}
	if improved != "Cats are nice." {
		t.Errorf("improved = %q", improved)
	}
	if h := header.Get("Authorization"); h != "" {
		t.Errorf("Authorization = %q, want none without a key", h)
	}
	if (*got)["model"] != "my-model" {
		t.Errorf("model = %v", (*got)["model"])
	}
}

func TestImproveTextProviderErrors(t *testing.T) {
	t.Run("custom provider without host or model", func(t *testing.T) {
		for _, cfg := range []AIConfig{
			{Provider: "custom", Model: "m"},
			{Provider: "custom", Host: "http://unused"},
		} {
			_, err := newTestApp().ImproveText("text", "Fix it.", cfg)
			if err == nil || !strings.Contains(err.Error(), "API URL and model") {
				t.Errorf("%+v: err = %v", cfg, err)
			}
		}
	})

	t.Run("missing API key", func(t *testing.T) {
		_, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Provider: "openai", Host: "http://unused"})
		if err == nil || !strings.Contains(err.Error(), "OpenAI API key") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("unknown provider", func(t *testing.T) {
		if _, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Provider: "nope"}); err == nil {
			t.Error("want an error")
		}
	})

	t.Run("error status names the provider", func(t *testing.T) {
		srv, _, _ := fakeProvider(t, "/v1/messages", http.StatusUnauthorized, `{"error":{"message":"invalid x-api-key"}}`)
		_, err := newTestApp().ImproveText("text", "Fix it.", AIConfig{Provider: "anthropic", Host: srv.URL, APIKey: "bad"})
		if err == nil || !strings.Contains(err.Error(), "Anthropic returned 401") || !strings.Contains(err.Error(), "invalid x-api-key") {
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

func TestGetDefaultSettings(t *testing.T) {
	s := newTestApp().GetDefaultSettings()
	if got := s.Providers["ollama"]; got.Host != defaultOllamaHost || got.Model != defaultOllamaModel {
		t.Errorf("ollama defaults = %+v", got)
	}
	for id, p := range s.Providers {
		if id != "custom" && (p.Host == "" || p.Model == "") {
			t.Errorf("provider %q has empty defaults: %+v", id, p)
		}
	}
}

// frontendIDs returns the sorted ids in the named array in settings.js,
// where they're written as `id: '<id>'`.
func frontendIDs(t *testing.T, name string) []string {
	t.Helper()
	src, err := os.ReadFile(filepath.Join("frontend", "src", "settings.js"))
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)export const ` + name + ` = \[(.*?)\n\]`).FindStringSubmatch(string(src))
	if block == nil {
		t.Fatalf("%s not found in settings.js", name)
	}
	var ids []string
	for _, m := range regexp.MustCompile(`id: '(\w+)'`).FindAllStringSubmatch(block[1], -1) {
		ids = append(ids, m[1])
	}
	sort.Strings(ids)
	return ids
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// The frontend's PROVIDERS must match the Go providers.
func TestProvidersMatchFrontend(t *testing.T) {
	frontend, backend := frontendIDs(t, "PROVIDERS"), sortedKeys(providers)
	if strings.Join(frontend, ",") != strings.Join(backend, ",") {
		t.Errorf("frontend provider ids %v != Go providers %v", frontend, backend)
	}
}

func TestWriteDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "essay.docx")
	data := []byte{0x50, 0x4b, 0x03, 0x04, 0x00} // binary-safe

	if err := newTestApp().WriteDocument(path, data); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(data) {
		t.Errorf("file = %v, want %v", got, data)
	}
}

func TestWriteDocumentReportsErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-dir", "essay.docx")
	if err := newTestApp().WriteDocument(path, []byte("x")); err == nil {
		t.Error("want an error")
	}
}

func TestWithDocumentExtension(t *testing.T) {
	cases := map[string]string{
		`C:\docs\essay.docx`:    `C:\docs\essay.docx`,
		`C:\docs\essay.TXT`:     `C:\docs\essay.TXT`,
		`C:\docs\essay.html`:    `C:\docs\essay.html`,
		`C:\docs\essay.htm`:     `C:\docs\essay.htm`,
		`C:\docs\essay`:         `C:\docs\essay.docx`,
		`C:\docs\essay.v2`:      `C:\docs\essay.v2.docx`,
		`/home/me/notes.backup`: `/home/me/notes.backup.docx`,
	}
	for in, want := range cases {
		if got := withDocumentExtension(in); got != want {
			t.Errorf("withDocumentExtension(%q) = %q, want %q", in, got, want)
		}
	}
}
