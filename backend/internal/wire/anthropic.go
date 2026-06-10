package wire

import (
	"encoding/json"

	"github.com/songguo/songguo/internal/calls"
)

func init() {
	register(Wire{
		Name:       "anthropic/messages",
		Suffixes:   []string{"/messages"},
		Modality:   calls.ModalityChat,
		Extract:    anthropicExtract,
		NewScanner: newAnthropicScanner,
	})
	register(Wire{
		Name:     "anthropic/models",
		Suffixes: []string{"/models"},
		Modality: calls.ModalityUnknown,
		Extract:  zeroCostExtract,
		ZeroCost: true,
	})
}

// anthropicExtract meters a non-streaming Messages body: top-level "usage"
// with input_tokens/output_tokens plus cache fields.
func anthropicExtract(body []byte, _ Quirks) Extraction {
	return anthropicNormalize(topLevelUsage(body))
}

// anthropicNormalize maps an Anthropic usage object to the canonical view.
// Anthropic reports cache reads/creation OUTSIDE input_tokens, while pricing
// treats CachedInputTokens as a subset of InputTokens — so cache fields are
// folded into InputTokens here. Cache creation is billed at the full input
// rate (its 1.25x premium is ignored as a deliberate simplification).
func anthropicNormalize(usage map[string]any) Extraction {
	if usage == nil {
		return Extraction{Confidence: calls.ConfidenceUnknown}
	}
	cacheRead := numAt(usage, "cache_read_input_tokens")
	cacheCreate := numAt(usage, "cache_creation_input_tokens")
	return Extraction{
		Raw: usage,
		Norm: Normalized{
			InputTokens:       numAt(usage, "input_tokens") + cacheRead + cacheCreate,
			OutputTokens:      numAt(usage, "output_tokens"),
			CachedInputTokens: cacheRead,
		},
		Confidence: calls.ConfidenceMeasured,
	}
}

// anthropicScanner merges usage across an Anthropic SSE stream: input-side
// counts arrive nested in the message_start event (message.usage); output
// counts arrive in message_delta events (top-level usage, cumulative). Both
// must be read or input tokens are silently dropped.
type anthropicScanner struct {
	lineScanner
	merged map[string]any
}

func newAnthropicScanner(_ Quirks) StreamScanner {
	s := &anthropicScanner{}
	s.onLine = s.processLine
	return s
}

func (s *anthropicScanner) processLine(line []byte) {
	payload, ok := ssePayload(line)
	if !ok {
		return
	}
	var env struct {
		Usage   map[string]any `json:"usage"`
		Message struct {
			Usage map[string]any `json:"usage"`
		} `json:"message"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		return
	}
	s.merge(env.Message.Usage)
	s.merge(env.Usage)
}

func (s *anthropicScanner) merge(usage map[string]any) {
	if usage == nil {
		return
	}
	if s.merged == nil {
		s.merged = make(map[string]any, len(usage))
	}
	for k, v := range usage {
		if v != nil {
			s.merged[k] = v
		}
	}
}

func (s *anthropicScanner) Result() Extraction {
	return anthropicNormalize(s.merged)
}
