// Package meter classifies proxied AI requests: it sniffs the modality from
// the URL path and the model from the request body. Usage extraction lives in
// the wire package (each wire owns its response shape); meter survives as the
// request-side classifier, including the fallback modality for
// allow-unmatched passthrough calls.
//
// All of meter is read-only sniffing: every parse failure yields a zero
// value, never an error.
package meter

import (
	"encoding/json"
	"strings"

	"github.com/songguo/songguo/internal/calls"
)

// Result is the outcome of classifying a request.
type Result struct {
	Modality calls.Modality
	Model    string
}

// Classify determines the modality of a call from its URL path (suffix match,
// case-insensitive) and best-effort extracts the model from the JSON request
// body. Model is empty if the body is not JSON or has no "model" field.
//
// The method argument is currently unused but is part of the proxy-facing API,
// as future modalities (e.g. MCP) may key off HTTP method.
func Classify(method, path string, body []byte) Result {
	return Result{
		Modality: modalityFromPath(path),
		Model:    modelFromBody(body),
	}
}

// modalityFromPath maps an upstream path to a modality using case-insensitive
// suffix matching. Trailing slashes and query strings are ignored.
func modalityFromPath(path string) calls.Modality {
	p := strings.ToLower(path)
	if i := strings.IndexByte(p, '?'); i >= 0 {
		p = p[:i]
	}
	p = strings.TrimRight(p, "/")

	switch {
	case strings.HasSuffix(p, "/chat/completions"):
		return calls.ModalityChat
	case strings.HasSuffix(p, "/completions"):
		return calls.ModalityChat
	case strings.HasSuffix(p, "/embeddings"):
		return calls.ModalityEmbedding
	case strings.HasSuffix(p, "/audio/speech"):
		return calls.ModalityTTS
	case strings.HasSuffix(p, "/audio/transcriptions"),
		strings.HasSuffix(p, "/audio/translations"):
		return calls.ModalitySTT
	case strings.HasSuffix(p, "/images/generations"),
		strings.HasSuffix(p, "/images/edits"):
		return calls.ModalityImage
	default:
		return calls.ModalityUnknown
	}
}

// modelFromBody pulls the "model" string from a JSON body, returning "" on any
// failure. It decodes only the model field to avoid materializing large bodies.
func modelFromBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var shallow struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &shallow); err != nil {
		return ""
	}
	return shallow.Model
}
