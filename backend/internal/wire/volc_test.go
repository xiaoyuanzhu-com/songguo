package wire

import "testing"

func TestVolcTTSResolve(t *testing.T) {
	w, ok := Resolve([]string{"volc/tts"}, "POST", "/api/v3/tts/unidirectional")
	if !ok || w.Name != "volc/tts" {
		t.Fatalf("Resolve = %q, %v; want volc/tts, true", w.Name, ok)
	}
}

func TestVolcVoiceCloneResolve(t *testing.T) {
	enabled := []string{"volc/tts", "volc/voice-clone"}
	for _, path := range []string{"/api/v3/tts/voice_clone", "/api/v3/tts/get_voice"} {
		w, ok := Resolve(enabled, "POST", path)
		if !ok || w.Name != "volc/voice-clone" {
			t.Fatalf("Resolve(%q) = %q, %v; want volc/voice-clone, true", path, w.Name, ok)
		}
		if !w.ZeroCost {
			t.Errorf("volc/voice-clone should be ZeroCost")
		}
	}
}

func TestVolcTTSExtract(t *testing.T) {
	body := []byte(`{"code":0,"message":"OK","data":"...","usage":{"text_words":7}}`)
	got := volcTTSExtract(body, nil)
	if got.Norm.Chars != 7 {
		t.Errorf("Chars = %v, want 7", got.Norm.Chars)
	}
	if got.Norm.InputTokens != 0 || got.Norm.OutputTokens != 0 {
		t.Errorf("tokens should be zero, got %+v", got.Norm)
	}
}

func TestVolcTTSScanner(t *testing.T) {
	s := newVolcTTSScanner(nil)
	// Chunked JSON lines, split across arbitrary write boundaries; usage
	// arrives on the final chunk.
	writes := []string{
		"{\"code\":0,\"data\":\"abc\"}\n{\"code\":0,",
		"\"data\":\"def\"}\n",
		"{\"code\":0,\"usage\":{\"text_words\":42}}\n",
	}
	for _, w := range writes {
		if _, err := s.Write([]byte(w)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	got := s.Result()
	if got.Norm.Chars != 42 {
		t.Errorf("Chars = %v, want 42", got.Norm.Chars)
	}
}

func TestVolcASRResolve(t *testing.T) {
	enabled := []string{"volc/asr"}
	for _, path := range []string{
		"/api/v3/auc/bigmodel/submit",
		"/api/v3/auc/bigmodel/query",
	} {
		w, ok := Resolve(enabled, "POST", path)
		if !ok || w.Name != "volc/asr" {
			t.Fatalf("Resolve(%q) = %q, %v; want volc/asr, true", path, w.Name, ok)
		}
		if w.Modality != "stt" {
			t.Errorf("Resolve(%q) modality = %q, want stt", path, w.Modality)
		}
	}
}

func TestVolcASRExtract(t *testing.T) {
	// Query poll: audio_info.duration (ms) → Seconds for per_second pricing.
	body := []byte(`{"audio_info":{"duration":12500},"result":{"text":"你好世界"}}`)
	got := volcASRExtract(body, nil)
	if got.Norm.Seconds != 12.5 {
		t.Errorf("Seconds = %v, want 12.5", got.Norm.Seconds)
	}
	if got.Confidence != "measured" {
		t.Errorf("Confidence = %q, want measured", got.Confidence)
	}

	// Nested shape: audio_info under result.
	nested := []byte(`{"result":{"text":"hi","audio_info":{"duration":3000}}}`)
	if got := volcASRExtract(nested, nil); got.Norm.Seconds != 3 {
		t.Errorf("nested Seconds = %v, want 3", got.Norm.Seconds)
	}

	// Submit ack (no audio_info yet): unknown, metered zero.
	ack := []byte(`{"task_id":"abc","message":"accepted"}`)
	if got := volcASRExtract(ack, nil); got.Confidence != "unknown" || got.Norm.Seconds != 0 {
		t.Errorf("ack = %+v, want unknown/0 seconds", got)
	}
}
