package pricing

import (
	"math"
	"testing"

	"github.com/songguo/songguo/internal/config"
	"github.com/songguo/songguo/internal/wire"
)

func approx(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestCost(t *testing.T) {
	tests := []struct {
		name  string
		price config.Price
		norm  wire.Normalized
		want  float64
	}{
		{
			name:  "per_1m_tokens",
			price: config.Price{Input: 3, Output: 15, Unit: "per_1m_tokens"},
			norm:  wire.Normalized{InputTokens: 1_000_000, OutputTokens: 2_000_000},
			want:  3*1 + 15*2,
		},
		{
			name:  "per_1k_tokens",
			price: config.Price{Input: 0.5, Output: 1.5, Unit: "per_1k_tokens"},
			norm:  wire.Normalized{InputTokens: 1000, OutputTokens: 2000},
			want:  0.5*1 + 1.5*2,
		},
		{
			name:  "per_token",
			price: config.Price{Input: 0.001, Output: 0.002, Unit: "per_token"},
			norm:  wire.Normalized{InputTokens: 10, OutputTokens: 5},
			want:  0.001*10 + 0.002*5,
		},
		{
			name:  "cached input billed at cached rate",
			price: config.Price{Input: 0.28, Output: 0.42, CachedInput: 0.028, Unit: "per_1m_tokens"},
			norm:  wire.Normalized{InputTokens: 1_000_000, CachedInputTokens: 600_000, OutputTokens: 0},
			want:  0.4*0.28 + 0.6*0.028,
		},
		{
			name:  "cached tokens without cached rate fall back to input rate",
			price: config.Price{Input: 3, Output: 15, Unit: "per_1m_tokens"},
			norm:  wire.Normalized{InputTokens: 1_000_000, CachedInputTokens: 400_000},
			want:  3.0,
		},
		{
			name:  "cached clamped to input total",
			price: config.Price{Input: 2, Output: 0, CachedInput: 1, Unit: "per_1m_tokens"},
			norm:  wire.Normalized{InputTokens: 1_000_000, CachedInputTokens: 5_000_000},
			want:  1.0,
		},
		{
			name:  "per_call defaults to one call",
			price: config.Price{Input: 0.01, Unit: "per_call"},
			norm:  wire.Normalized{},
			want:  0.01,
		},
		{
			name:  "per_call explicit count",
			price: config.Price{Input: 0.01, Unit: "per_call"},
			norm:  wire.Normalized{Calls: 3},
			want:  0.03,
		},
		{
			name:  "per_image",
			price: config.Price{Input: 0.04, Unit: "per_image"},
			norm:  wire.Normalized{Images: 2},
			want:  0.08,
		},
		{
			name:  "per_second",
			price: config.Price{Input: 0.0001, Unit: "per_second"},
			norm:  wire.Normalized{Seconds: 90},
			want:  0.009,
		},
		{
			name:  "per_char",
			price: config.Price{Input: 0.00002, Unit: "per_char"},
			norm:  wire.Normalized{Chars: 500},
			want:  0.01,
		},
		{
			name:  "unknown unit yields zero",
			price: config.Price{Input: 3, Output: 15, Unit: "per_banana"},
			norm:  wire.Normalized{InputTokens: 1_000_000},
			want:  0,
		},
		{
			name:  "empty unit yields zero",
			price: config.Price{Input: 3, Output: 15},
			norm:  wire.Normalized{InputTokens: 1_000_000},
			want:  0,
		},
		{
			name:  "zero usage zero cost",
			price: config.Price{Input: 3, Output: 15, Unit: "per_1m_tokens"},
			norm:  wire.Normalized{},
			want:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Cost(tt.price, tt.norm)
			if !approx(got, tt.want) {
				t.Errorf("Cost() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestCostDeepSeekRealWorld prices a realistic DeepSeek call: cache hits at
// ~1/10 of the miss rate must dominate the bill when most input is cached.
func TestCostDeepSeekRealWorld(t *testing.T) {
	price := config.Price{Input: 0.14, Output: 0.28, CachedInput: 0.0028, Unit: "per_1m_tokens"}
	norm := wire.Normalized{InputTokens: 100_000, CachedInputTokens: 90_000, OutputTokens: 5_000}
	got := Cost(price, norm)
	want := (10_000*0.14 + 90_000*0.0028 + 5_000*0.28) / 1e6
	if !approx(got, want) {
		t.Errorf("Cost() = %v, want %v", got, want)
	}
	// Sanity: ignoring the cache discount would overcharge ~8x on input.
	full := Cost(config.Price{Input: 0.14, Output: 0.28, Unit: "per_1m_tokens"}, norm)
	if full <= got {
		t.Errorf("expected discount: full %v should exceed discounted %v", full, got)
	}
}
