package proxy

import "testing"

// TestBuildUpstreamURL covers the model-routed URL construction: {model}
// substitution and query merging (an endpoint may carry its own query, e.g.
// Azure's api-version, which is unioned with any inbound query).
func TestBuildUpstreamURL(t *testing.T) {
	cases := []struct {
		name, endpoint, model, inboundQuery, want string
	}{
		{
			name:     "plain endpoint, no query",
			endpoint: "https://api.openai.com/v1/chat/completions",
			model:    "gpt-4o",
			want:     "https://api.openai.com/v1/chat/completions",
		},
		{
			name:         "plain endpoint with inbound query",
			endpoint:     "https://api.openai.com/v1/chat/completions",
			model:        "gpt-4o",
			inboundQuery: "stream=true",
			want:         "https://api.openai.com/v1/chat/completions?stream=true",
		},
		{
			name:     "model placeholder substituted",
			endpoint: "https://r.openai.azure.com/openai/deployments/{model}/chat/completions",
			model:    "gpt-4o",
			want:     "https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions",
		},
		{
			name:     "endpoint query preserved when no inbound query",
			endpoint: "https://r.openai.azure.com/openai/deployments/{model}/chat/completions?api-version=2024-10-21",
			model:    "gpt-4o",
			want:     "https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
		},
		{
			name:         "endpoint query merged with inbound query",
			endpoint:     "https://r.openai.azure.com/openai/deployments/{model}/chat/completions?api-version=2024-10-21",
			model:        "gpt-4o",
			inboundQuery: "stream=true",
			want:         "https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21&stream=true",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildUpstreamURL(c.endpoint, c.model, c.inboundQuery)
			if got != c.want {
				t.Errorf("buildUpstreamURL(%q, %q, %q) = %q, want %q", c.endpoint, c.model, c.inboundQuery, got, c.want)
			}
		})
	}
}
