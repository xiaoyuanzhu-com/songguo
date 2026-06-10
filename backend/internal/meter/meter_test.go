package meter

import (
	"testing"

	"github.com/songguo/songguo/internal/calls"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		body     string
		wantMod  calls.Modality
		wantModl string
	}{
		{"chat completions", "/v1/chat/completions", `{"model":"gpt-4o"}`, calls.ModalityChat, "gpt-4o"},
		{"legacy completions", "/v1/completions", `{"model":"gpt-3.5-turbo-instruct"}`, calls.ModalityChat, "gpt-3.5-turbo-instruct"},
		{"embeddings", "/v1/embeddings", `{"model":"text-embedding-3-small"}`, calls.ModalityEmbedding, "text-embedding-3-small"},
		{"tts", "/v1/audio/speech", `{"model":"tts-1"}`, calls.ModalityTTS, "tts-1"},
		{"stt transcriptions", "/v1/audio/transcriptions", `{"model":"whisper-1"}`, calls.ModalitySTT, "whisper-1"},
		{"stt translations", "/v1/audio/translations", `{"model":"whisper-1"}`, calls.ModalitySTT, "whisper-1"},
		{"image generations", "/v1/images/generations", `{"model":"dall-e-3"}`, calls.ModalityImage, "dall-e-3"},
		{"image edits", "/v1/images/edits", `{"model":"dall-e-2"}`, calls.ModalityImage, "dall-e-2"},
		{"unknown path", "/v1/moderations", `{"model":"omni-moderation"}`, calls.ModalityUnknown, "omni-moderation"},
		{"case insensitive", "/V1/Chat/Completions", `{"model":"gpt-4o"}`, calls.ModalityChat, "gpt-4o"},
		{"trailing slash and query", "/v1/chat/completions/?stream=true", `{"model":"gpt-4o"}`, calls.ModalityChat, "gpt-4o"},
		{"non-json body modality only", "/v1/chat/completions", "not json at all", calls.ModalityChat, ""},
		{"empty body", "/v1/embeddings", "", calls.ModalityEmbedding, ""},
		{"json without model", "/v1/chat/completions", `{"messages":[]}`, calls.ModalityChat, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Classify("POST", tt.path, []byte(tt.body))
			if got.Modality != tt.wantMod {
				t.Errorf("Modality = %q, want %q", got.Modality, tt.wantMod)
			}
			if got.Model != tt.wantModl {
				t.Errorf("Model = %q, want %q", got.Model, tt.wantModl)
			}
		})
	}
}
