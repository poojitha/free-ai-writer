package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AIConfig picks the provider ImproveText talks to and how to reach it.
// Empty fields fall back to that provider's defaults; an empty Provider means
// Ollama.
type AIConfig struct {
	Provider string `json:"provider"`
	Host     string `json:"host"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
}

// ProviderDefaults are a provider's built-in host and model.
type ProviderDefaults struct {
	Host  string `json:"host"`
	Model string `json:"model"`
}

// provider sends a full prompt to one AI service and returns its raw reply.
type provider struct {
	name     string
	defaults ProviderDefaults
	needsKey bool
	generate func(ctx context.Context, host, model, apiKey, prompt string) (string, error)
}

const anthropicMaxTokens = 4096

// providers are keyed by the ids the frontend uses (PROVIDERS in
// settings.js). "custom" (shown as "Other") is any OpenAI-compatible server
// (LM Studio, OpenRouter, Groq...); it has no defaults, so the user must give
// its host and model, and the API key is optional.
var providers = map[string]provider{
	"ollama": {
		name:     "Ollama",
		defaults: ProviderDefaults{Host: defaultOllamaHost, Model: defaultOllamaModel},
		generate: generateOllama,
	},
	"openai": {
		name:     "OpenAI",
		defaults: ProviderDefaults{Host: "https://api.openai.com/v1", Model: "gpt-5-mini"},
		needsKey: true,
		generate: generateOpenAI,
	},
	"anthropic": {
		name:     "Anthropic",
		defaults: ProviderDefaults{Host: "https://api.anthropic.com", Model: "claude-sonnet-5-5"},
		needsKey: true,
		generate: generateAnthropic,
	},
	"custom": {
		name:     "the AI server",
		generate: generateOpenAI,
	},
}

type ollamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
}

func generateOllama(ctx context.Context, host, model, _, prompt string) (string, error) {
	var result ollamaGenerateResponse
	err := postJSON(ctx, host+"/api/generate", nil,
		ollamaGenerateRequest{Model: model, Prompt: prompt}, &result)
	return result.Response, err
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

func generateOpenAI(ctx context.Context, host, model, apiKey, prompt string) (string, error) {
	headers := map[string]string{}
	if apiKey != "" {
		headers["Authorization"] = "Bearer " + apiKey
	}
	var result openAIChatResponse
	err := postJSON(ctx, host+"/chat/completions", headers,
		openAIChatRequest{Model: model, Messages: []chatMessage{{Role: "user", Content: prompt}}},
		&result)
	if err != nil || len(result.Choices) == 0 {
		return "", err
	}
	return result.Choices[0].Message.Content, nil
}

type anthropicMessagesRequest struct {
	Model     string        `json:"model"`
	MaxTokens int           `json:"max_tokens"`
	Messages  []chatMessage `json:"messages"`
}

type anthropicMessagesResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

func generateAnthropic(ctx context.Context, host, model, apiKey, prompt string) (string, error) {
	var result anthropicMessagesResponse
	err := postJSON(ctx, host+"/v1/messages",
		map[string]string{"x-api-key": apiKey, "anthropic-version": "2023-06-01"},
		anthropicMessagesRequest{
			Model:     model,
			MaxTokens: anthropicMaxTokens,
			Messages:  []chatMessage{{Role: "user", Content: prompt}},
		},
		&result)
	var text strings.Builder
	for _, block := range result.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return text.String(), err
}

// errUnreachable wraps network failures so ImproveText can name the provider.
type errUnreachable struct{ err error }

func (e errUnreachable) Error() string { return e.err.Error() }
func (e errUnreachable) Unwrap() error { return e.err }

// postJSON POSTs body as JSON with the given extra headers and decodes a 200
// reply into out. Any other status becomes an error carrying the reply body.
func postJSON(ctx context.Context, url string, headers map[string]string, body, out any) error {
	reqBody, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return errUnreachable{err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("returned %d: %s", resp.StatusCode, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
