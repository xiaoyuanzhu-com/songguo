package wire

import (
	"encoding/json"

	"github.com/songguo/songguo/internal/calls"
)

func init() {
	register(Wire{
		Name:       "volc/tts",
		Suffixes:   []string{"/tts/unidirectional"},
		Modality:   calls.ModalityTTS,
		Extract:    volcTTSExtract,
		NewScanner: newVolcTTSScanner,
	})
	// Voice-cloning management: train a custom voice (/tts/voice_clone) and
	// poll its status (/tts/get_voice). These return no usage object — the
	// voice-slot fee is billed out-of-band on first synthesis — so they meter
	// as free, like a model-listing endpoint.
	register(Wire{
		Name:     "volc/voice-clone",
		Suffixes: []string{"/tts/voice_clone", "/tts/get_voice"},
		Modality: calls.ModalityTTS,
		Extract:  zeroCostExtract,
		ZeroCost: true,
	})
	// Bigmodel file recognition (录音文件识别, e.g. doubao-seed-asr): an async
	// submit→poll pair. submit returns only an ack; the transcript and billed
	// audio duration arrive on a later query poll, so one wire covers both
	// suffixes and meters whichever body carries audio_info.duration. Billing
	// lands on the query call (per_second on the audio length); the submit call
	// meters zero.
	register(Wire{
		Name:     "volc/asr",
		Suffixes: []string{"/auc/bigmodel/submit", "/auc/bigmodel/query"},
		Modality: calls.ModalitySTT,
		Extract:  volcASRExtract,
	})
}

// volcASRExtract meters a Volcengine bigmodel file-ASR response by the
// recognized audio length: audio_info.duration is milliseconds, mapped to
// Seconds for per_second pricing. The submit ack carries no audio_info, so it
// extracts as unknown (metered zero) — only the query poll bills.
func volcASRExtract(body []byte, _ Quirks) Extraction {
	if len(body) == 0 {
		return Extraction{Confidence: calls.ConfidenceUnknown}
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return Extraction{Confidence: calls.ConfidenceUnknown}
	}
	// Duration sits at audio_info.duration; some payloads nest the whole result
	// (audio_info included) under a "result" object, so try both.
	durMs := numAt(m, "audio_info", "duration")
	if durMs == 0 {
		durMs = numAt(m, "result", "audio_info", "duration")
	}
	if durMs == 0 {
		return Extraction{Confidence: calls.ConfidenceUnknown}
	}
	return Extraction{
		Raw:        map[string]any{"duration_ms": durMs},
		Norm:       Normalized{Seconds: durMs / 1000},
		Confidence: calls.ConfidenceMeasured,
	}
}

// volcTTSExtract meters a Volcengine speech-synthesis response. Billing is by
// input text characters (usage.text_words, punctuation included), returned
// when the client sets X-Control-Require-Usage-Tokens-Return; it maps to
// Chars for per_char pricing.
func volcTTSExtract(body []byte, _ Quirks) Extraction {
	return volcTTSNormalize(topLevelUsage(body))
}

func volcTTSNormalize(usage map[string]any) Extraction {
	if usage == nil {
		return Extraction{Confidence: calls.ConfidenceUnknown}
	}
	return Extraction{
		Raw:        usage,
		Norm:       Normalized{Chars: numAt(usage, "text_words")},
		Confidence: calls.ConfidenceMeasured,
	}
}

// volcTTSScanner meters the HTTP-chunked streaming form: newline-delimited
// JSON objects (bare, not SSE-framed), with usage carried on the chunks that
// report it. The latest non-null usage wins.
type volcTTSScanner struct {
	lineScanner
	usage map[string]any
}

func newVolcTTSScanner(_ Quirks) StreamScanner {
	s := &volcTTSScanner{}
	s.onLine = s.processLine
	return s
}

func (s *volcTTSScanner) processLine(line []byte) {
	var env struct {
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(line, &env); err != nil {
		return
	}
	if env.Usage != nil {
		s.usage = env.Usage
	}
}

func (s *volcTTSScanner) Result() Extraction {
	return volcTTSNormalize(s.usage)
}
