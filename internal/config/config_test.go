package config

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const validYAML = `
settings:
  listen: ":8080"
vendors:
  - name: openai-main
    base_url: https://api.openai.com
    served_models: [gpt-4o, gpt-4o-mini, text-embedding-3-small]
    priority: 1
    weight: 1
    credentials:
      - id: openai-key-1
        api_key: sk-aaa
    prices:
      gpt-4o:                  { input: 2.50, output: 10.00, unit: per_1m_tokens }
      gpt-4o-mini:            { input: 0.15, output: 0.60,  unit: per_1m_tokens }
      text-embedding-3-small: { input: 0.02,                unit: per_1m_tokens }
  - name: deepseek
    base_url: https://api.deepseek.com
    served_models: [deepseek-chat, gpt-4o]
    priority: 2
    credentials:
      - id: deepseek-key-1
        api_key: sk-bbb
    prices:
      deepseek-chat: { input: 0.27, output: 1.10, unit: per_1m_tokens }
`

func TestParseValid(t *testing.T) {
	snap, err := Parse([]byte(validYAML))
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if got := snap.Settings().Listen; got != ":8080" {
		t.Errorf("Listen = %q, want :8080", got)
	}
	if got := len(snap.Vendors()); got != 2 {
		t.Fatalf("len(Vendors) = %d, want 2", got)
	}

	v, ok := snap.Vendor("openai-main")
	if !ok {
		t.Fatal("Vendor(openai-main) not found")
	}
	if v.Priority != 1 {
		t.Errorf("openai-main priority = %d, want 1", v.Priority)
	}

	p, ok := snap.PriceFor("openai-main", "gpt-4o")
	if !ok {
		t.Fatal("PriceFor(openai-main, gpt-4o) not found")
	}
	if p.Input != 2.50 || p.Output != 10.00 || p.Unit != "per_1m_tokens" {
		t.Errorf("gpt-4o price = %+v, unexpected", p)
	}

	// A model with no price entry is allowed.
	if _, ok := snap.PriceFor("deepseek", "gpt-4o"); ok {
		t.Error("expected no price for deepseek/gpt-4o")
	}
}

func TestVendorsForModel_MultiVendor(t *testing.T) {
	snap, err := Parse([]byte(validYAML))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	vs := snap.VendorsForModel("gpt-4o")
	if len(vs) != 2 {
		t.Fatalf("VendorsForModel(gpt-4o) = %d vendors, want 2", len(vs))
	}
	names := map[string]bool{vs[0].Name: true, vs[1].Name: true}
	if !names["openai-main"] || !names["deepseek"] {
		t.Errorf("VendorsForModel(gpt-4o) names = %v, want openai-main + deepseek", names)
	}

	if got := snap.VendorsForModel("deepseek-chat"); len(got) != 1 || got[0].Name != "deepseek" {
		t.Errorf("VendorsForModel(deepseek-chat) = %+v, want [deepseek]", got)
	}
	if got := snap.VendorsForModel("does-not-exist"); got != nil {
		t.Errorf("VendorsForModel(unknown) = %v, want nil", got)
	}
}

func TestSnapshotReturnsCopies(t *testing.T) {
	snap, err := Parse([]byte(validYAML))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	v, _ := snap.Vendor("openai-main")
	v.ServedModels[0] = "mutated"
	v.Prices["gpt-4o"] = Price{Input: 999}
	v.Credentials[0].APIKey = "leaked"

	again, _ := snap.Vendor("openai-main")
	if again.ServedModels[0] == "mutated" {
		t.Error("mutating returned ServedModels leaked into snapshot")
	}
	if again.Prices["gpt-4o"].Input == 999 {
		t.Error("mutating returned Prices leaked into snapshot")
	}
	if again.Credentials[0].APIKey == "leaked" {
		t.Error("mutating returned Credentials leaked into snapshot")
	}
}

func TestEmptyConfigValid(t *testing.T) {
	snap, err := Parse([]byte(""))
	if err != nil {
		t.Fatalf("empty config should be valid, got: %v", err)
	}
	if len(snap.Vendors()) != 0 {
		t.Errorf("expected 0 vendors, got %d", len(snap.Vendors()))
	}
	if snap.Settings().Listen != "" {
		t.Errorf("expected empty listen, got %q", snap.Settings().Listen)
	}
}

func TestWeightNormalization(t *testing.T) {
	const y = `
vendors:
  - name: a
    base_url: https://a.example.com
    served_models: [m1]
    credentials: [{id: ka, api_key: k}]
  - name: b
    base_url: https://b.example.com
    served_models: [m2]
    weight: 5
    credentials: [{id: kb, api_key: k}]
  - name: c
    base_url: https://c.example.com
    served_models: [m3]
    weight: -3
    credentials: [{id: kc, api_key: k}]
`
	snap, err := Parse([]byte(y))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	want := map[string]int{"a": 1, "b": 5, "c": 1}
	for name, w := range want {
		v, _ := snap.Vendor(name)
		if v.Weight != w {
			t.Errorf("vendor %s weight = %d, want %d", name, v.Weight, w)
		}
	}
}

func TestValidationFailures(t *testing.T) {
	tests := []struct {
		name     string
		yaml     string
		wantSubs []string
	}{
		{
			name: "duplicate vendor name",
			yaml: `
vendors:
  - {name: dup, base_url: https://a.example.com, served_models: [m1], credentials: [{id: k1, api_key: k}]}
  - {name: dup, base_url: https://b.example.com, served_models: [m2], credentials: [{id: k2, api_key: k}]}
`,
			wantSubs: []string{"duplicate vendor name"},
		},
		{
			name: "missing base_url",
			yaml: `
vendors:
  - {name: a, served_models: [m1], credentials: [{id: k1, api_key: k}]}
`,
			wantSubs: []string{"base_url must be non-empty"},
		},
		{
			name: "bad base_url scheme",
			yaml: `
vendors:
  - {name: a, base_url: "ftp://x", served_models: [m1], credentials: [{id: k1, api_key: k}]}
`,
			wantSubs: []string{"absolute http or https"},
		},
		{
			name: "relative base_url",
			yaml: `
vendors:
  - {name: a, base_url: "/relative/path", served_models: [m1], credentials: [{id: k1, api_key: k}]}
`,
			wantSubs: []string{"absolute http or https"},
		},
		{
			name: "empty served_models",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [], credentials: [{id: k1, api_key: k}]}
`,
			wantSubs: []string{"served_models must be non-empty"},
		},
		{
			name: "duplicate model within vendor",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [m1, m1], credentials: [{id: k1, api_key: k}]}
`,
			wantSubs: []string{"duplicate served model"},
		},
		{
			name: "duplicate credential id across vendors",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [m1], credentials: [{id: shared, api_key: k}]}
  - {name: b, base_url: https://b.example.com, served_models: [m2], credentials: [{id: shared, api_key: k}]}
`,
			wantSubs: []string{"already used by"},
		},
		{
			name: "empty credentials",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [m1], credentials: []}
`,
			wantSubs: []string{"credentials must be non-empty"},
		},
		{
			name: "missing api_key",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [m1], credentials: [{id: k1}]}
`,
			wantSubs: []string{"empty api_key"},
		},
		{
			name: "empty credential id",
			yaml: `
vendors:
  - {name: a, base_url: https://a.example.com, served_models: [m1], credentials: [{id: "", api_key: k}]}
`,
			wantSubs: []string{"empty id"},
		},
		{
			name: "price with empty unit",
			yaml: `
vendors:
  - name: a
    base_url: https://a.example.com
    served_models: [m1]
    credentials: [{id: k1, api_key: k}]
    prices:
      m1: {input: 1.0, output: 2.0}
`,
			wantSubs: []string{"empty unit"},
		},
		{
			name: "aggregates multiple problems",
			yaml: `
vendors:
  - {name: "", served_models: [], credentials: []}
`,
			wantSubs: []string{"name must be non-empty", "base_url must be non-empty", "served_models must be non-empty", "credentials must be non-empty"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.yaml))
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			msg := err.Error()
			for _, sub := range tc.wantSubs {
				if !strings.Contains(msg, sub) {
					t.Errorf("error %q does not contain %q", msg, sub)
				}
			}
		})
	}
}

func TestLoadFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	snap, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if len(snap.Vendors()) != 2 {
		t.Errorf("expected 2 vendors, got %d", len(snap.Vendors()))
	}

	if _, err := LoadFile(filepath.Join(dir, "missing.yaml")); !isNotExist(err) {
		t.Errorf("LoadFile(missing) error = %v, want not-exist", err)
	}
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// waitFor polls cond up to 3s.
func waitFor(t *testing.T, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func TestManagerHotReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := NewManager(path, quietLogger())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	if got := len(m.Current().Vendors()); got != 2 {
		t.Fatalf("initial vendors = %d, want 2", got)
	}

	reloaded := make(chan *Snapshot, 1)
	m.OnReload(func(s *Snapshot) {
		select {
		case reloaded <- s:
		default:
		}
	})

	const updated = `
vendors:
  - name: solo
    base_url: https://solo.example.com
    served_models: [only-model]
    credentials: [{id: solo-key, api_key: k}]
`
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		t.Fatal(err)
	}

	ok := waitFor(t, func() bool {
		_, found := m.Current().Vendor("solo")
		return found
	})
	if !ok {
		t.Fatalf("config did not reload within timeout; vendors=%d", len(m.Current().Vendors()))
	}

	select {
	case <-reloaded:
	case <-time.After(time.Second):
		t.Error("OnReload callback was not fired")
	}
}

func TestManagerKeepsPreviousOnInvalid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := NewManager(path, quietLogger())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	// Write an invalid config (duplicate vendor names).
	const bad = `
vendors:
  - {name: dup, base_url: https://a.example.com, served_models: [m1], credentials: [{id: k1, api_key: k}]}
  - {name: dup, base_url: https://b.example.com, served_models: [m2], credentials: [{id: k2, api_key: k}]}
`
	if err := os.WriteFile(path, []byte(bad), 0o644); err != nil {
		t.Fatal(err)
	}

	// Give the watcher time to process and (correctly) reject the change.
	time.Sleep(700 * time.Millisecond)

	if _, ok := m.Current().Vendor("openai-main"); !ok {
		t.Error("invalid reload should have kept the previous good snapshot")
	}
	if len(m.Current().Vendors()) != 2 {
		t.Errorf("vendors = %d, want previous 2", len(m.Current().Vendors()))
	}
}

func TestManagerMissingFileStartsEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml") // not created yet

	m, err := NewManager(path, quietLogger())
	if err != nil {
		t.Fatalf("NewManager with missing file should not error: %v", err)
	}
	defer m.Close()

	if m.Current() == nil {
		t.Fatal("Current() is nil")
	}
	if len(m.Current().Vendors()) != 0 {
		t.Errorf("expected empty config, got %d vendors", len(m.Current().Vendors()))
	}

	// A file created later should be picked up.
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	ok := waitFor(t, func() bool {
		return len(m.Current().Vendors()) == 2
	})
	if !ok {
		t.Fatalf("late-created file not loaded; vendors=%d", len(m.Current().Vendors()))
	}
}

func TestManagerInvalidAtStartupFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("vendors: [{name: x}]"), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path, quietLogger())
	if err == nil {
		m.Close()
		t.Fatal("expected NewManager to fail on invalid startup config")
	}
}

func TestManagerCloseIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path, quietLogger())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	if err := m.Close(); err != nil {
		t.Errorf("first Close: %v", err)
	}
	// Second Close must not panic (channel double-close guarded).
	_ = m.Close()
}
