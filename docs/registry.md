# Songguo — Wire Registry

> Reference for everything Songguo can proxy. Companion to `prd.md` (product) — this is the concrete catalogue.

## Lead principle: proxy + track, nothing else

Songguo is a **gate + meter, not a transformer**. For every request it:

- **Mutates exactly one thing** — the credential. It swaps the consumer's Songguo token for the real upstream key (auth adapter per wire, see below).
- **Never touches** the request body, the `model` string, or any other header; never rewrites the response.
- **Reads** the response only to meter usage. For streams it tees the bytes through untouched and observes them in flight.

That means, explicitly:

- **No format translation.** The body that arrives is the body that's forwarded. Consumers use each vendor's native SDK/protocol.
- **No model mapping / aliasing — ever.** The `model` string is matched exactly and passed through verbatim. There is no rename, no group, no 重定向, no 倍率分组.
- **No async→sync conversion.** Submit→poll lifecycles are owned by the consumer; Songguo forwards and meters each call independently.
- **Metering is read-only sniffing.** If a usage shape isn't recognized the call still succeeds (coarse/unknown metering) — **parsing never blocks traffic.**
- **"Quirks" parameterize how usage is _read_, never what is _sent._** e.g. `{"cache_tokens":"deepseek"}` only tells the meter which field holds cached tokens; the forwarded payload is identical.

The only thing Songguo will refuse to forward is an over-budget / out-of-scope call (it _rejects_, it does not _transform_).

## The model: four layers

A **wire** is the protocol contract. A **Songguo endpoint** is its inbound face; a **provider endpoint** is its outbound face; **routing** connects one to the other by exact model string.

| Layer | What it is | Static / dynamic | Cardinality |
|---|---|---|---|
| **Wire** | Protocol shape + metering contract (`openai/chat`). The fixed vocabulary. | Static (compiled-in, 10 today) | the catalogue |
| **Songguo endpoint** | The public path a consumer calls (`POST /v1/chat/completions`). Inbound face of a wire. | Static (matched by suffix) | → exactly 1 wire |
| **Provider endpoint** | An **exact vendor URL** that speaks the same wire (`https://api.openai.com/v1/chat/completions`) + its credential. Outbound face. | Dynamic (operator-set, SQLite) | → exactly 1 wire |
| **Routing** | Given `(wire, model-string)` pick the provider endpoint. Exact match, no aliasing. | Dynamic (SQLite) | model-string → provider |

Request lifecycle, one line:

```
inbound path → match Songguo endpoint → (wire) → read model string
            → routing picks provider endpoint for (wire, model)
            → forward to exact vendor URL, swap auth, body + model unchanged
            → wire meters the response (read-only)
```

### There is no "base URL" concept

Every endpoint — inbound and outbound — is a **full, explicit path**. Songguo never derives multiple endpoints from a base; each wire is its own entry. The `base_url` field that SDKs require survives **only as derived text in connect snippets** (the OpenAI SDK appends `/chat/completions` itself, so its card shows `<origin>/v1`; the Anthropic SDK appends `/v1/messages`, so its card shows `<origin>`). That value is presentation, computed per protocol family — it is never stored and never participates in routing.

### Path matching semantics

Matching is by **path suffix**, scoped to the service's enabled wires:

- Case-insensitive; query string and trailing slashes stripped.
- **Longest matching suffix wins** (`/chat/completions` beats `/completions`); ties break lexicographically by wire name.
- No match → **deny** (unless the service opts into unmatched passthrough).

Because matching is suffix-based, the path _prefix_ is conventional. The canonical endpoints below use each vendor's standard prefix (`/v1/...`); a request to any path ending in the same suffix resolves the same way.

### Addressing modes — model-bearing vs model-less

How a request finds its provider depends on whether the call carries a `model`:

- **Mode A — model-routed (`/v1/...`).** The gateway reads the exact `model` string from the body and picks the provider(s) that declare it (pooling + failover apply). Used by the model-bearing wires (`openai/chat|completions|embeddings|responses`, `anthropic/messages`). **A `/v1/...` call with no model string is rejected `400 missing_model`** — there is nothing to route on.
- **Mode B — passthrough (`/x/<provider>/<native-path>`).** The provider is named explicitly in the path; no model is required; a single attempt, no failover. Used by every **model-less** wire — all `*/models` listings, the `volc/*` speech wires, and async submit/poll calls. The native vendor path after `/x/<provider>/` is preserved and matched by suffix.

Consequence: **a model-less endpoint is always addressed via `/x/<provider>/`, never bare.** Bare `GET /v1/models` does not work (it 400s) — and that is deliberate: aggregating providers' model lists would mean *synthesizing* a response, which violates no-transform. List models per provider with `GET /x/<provider>/v1/models`.

## The registry — everything supported today (10 wires)

### OpenAI family — auth: `Authorization: Bearer <key>`

| Wire | Songguo endpoint | Matched suffix | Modality | Streams | Cost |
|---|---|---|---|---|---|
| `openai/chat` | `POST /v1/chat/completions` | `/chat/completions` | chat | yes (SSE) | metered |
| `openai/completions` | `POST /v1/completions` | `/completions` | chat | yes (SSE) | metered |
| `openai/embeddings` | `POST /v1/embeddings` | `/embeddings` | embedding | no | metered |
| `openai/responses` | `POST /v1/responses` | `/responses` | chat | yes (SSE) | metered |
| `openai/models` | `GET /x/<provider>/v1/models` | `/models` | — | no | zero-cost |

### Anthropic family — auth: `x-api-key: <key>` + `anthropic-version: <date>`

| Wire | Songguo endpoint | Matched suffix | Modality | Streams | Cost |
|---|---|---|---|---|---|
| `anthropic/messages` | `POST /v1/messages` | `/messages` | chat | yes (SSE) | metered |
| `anthropic/models` | `GET /x/<provider>/v1/models` | `/models` | — | no | zero-cost |

### Volcengine speech family — auth: `x-api-key: <key>` — all Mode B (`/x/<provider>/`)

| Wire | Songguo endpoint | Matched suffix | Modality | Streams | Cost |
|---|---|---|---|---|---|
| `volc/tts` | `POST /x/<provider>/api/v3/tts/unidirectional` | `/tts/unidirectional` | tts | yes (NDJSON) | metered |
| `volc/voice-clone` | `POST /x/<provider>/api/v3/tts/voice_clone`, `GET /x/<provider>/api/v3/tts/get_voice` | `/tts/voice_clone`, `/tts/get_voice` | tts (mgmt) | no | zero-cost |
| `volc/asr` | `POST /x/<provider>/api/v3/auc/bigmodel/submit`, `POST /x/<provider>/api/v3/auc/bigmodel/query` | `/auc/bigmodel/submit`, `/auc/bigmodel/query` | stt | no | metered on `query` |

Volcengine speech is model-less, so it is addressed via `/x/<provider>/` passthrough with the **native Volcengine path** (`/api/v3/...`). The provider is explicit; the suffix is what the wire matches.

## Metering — how each wire reads usage

All wires normalize into one canonical view: `{ InputTokens, OutputTokens, CachedInputTokens, Calls, Images, Seconds, Chars }`. Raw vendor usage is logged verbatim alongside.

- **`openai/chat`, `openai/completions`, `openai/embeddings`** — top-level `usage`: `prompt_tokens`/`input_tokens`, `completion_tokens`/`output_tokens`. Cached input tokens read per quirk: default `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`, MiniMax `cached_tokens`. Streaming usage rides the final SSE chunk (some vendors only when the client sets `stream_options.include_usage`).
- **`openai/responses`** — top-level `usage` (`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`); streaming usage rides the `response.completed` event under `response.usage`.
- **`anthropic/messages`** — `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` folded into `InputTokens` (cache-create's 1.25× premium ignored, by design); `cache_read` also recorded as `CachedInputTokens`. Streaming merges `message_start.message.usage` (input) with `message_delta.usage` (output).
- **`volc/tts`** — `usage.text_words` → `Chars` (per-char pricing). Usage is only returned when the client sets `X-Control-Require-Usage-Tokens-Return`; otherwise coarse/unknown.
- **`volc/asr`** — `audio_info.duration` (ms) → `Seconds` (per-second pricing). The `submit` ack carries no `audio_info`, so it meters zero; the `query` poll bills.
- **`*/models`, `volc/voice-clone`** — zero-cost management endpoints; not parsed. (Voice-clone's slot fee is billed out-of-band on first synthesis.)

## Auth adapters

Derived from the wire name prefix — the operator never picks it.

| Adapter | Wires | Scheme |
|---|---|---|
| `openai-compatible` | `openai/*` | `Authorization: Bearer <key>` |
| `anthropic-compatible` | `anthropic/*` | `x-api-key: <key>` + `anthropic-version` header |
| `volc-speech` | `volc/*` | `x-api-key: <key>` |

## Resolved decisions

1. **`/v1/models` is not ambiguous.** Model-listing carries no model string, so bare `/v1/models` is rejected `400 missing_model` (Mode A needs a model) — the `openai/models`/`anthropic/models` suffix tie-break is never reached. Listing is a Mode-B operation: `GET /x/<provider>/v1/models` resolves against one provider's wires, which hold at most one `/models` wire. By design Songguo does **not** aggregate model lists (that would be a synthesized response = transform).
2. **Volcengine paths are the native `/api/v3/...`**, addressed via `/x/<provider>/` passthrough (speech is model-less). Pinned by `wire/volc_test.go`. No Songguo-local prefix.

## Implementation status

- **Full per-wire endpoints — done.** Provider config stores an explicit full upstream URL per wire (DB column `provider_endpoints.endpoint`), used as-is in model-routed (Mode A) forwarding — no base+suffix join. `{model}` in the path is substituted with the request's model, and an endpoint query (e.g. Azure's `?api-version=…`) is merged with any inbound query, so non-uniform vendors like **Azure OpenAI** (`/openai/deployments/{model}/chat/completions?api-version=…`) work. Mode B / WebSocket use the vendor's `origin` (scheme://host). Runtime vendors group by `(origin, adapter)`. A one-time idempotent migration renames `base_url`→`endpoint` and rewrites legacy bases to full URLs.
- **Still open:** `prd.md` §4.1 still models `Channel.base_url`; "Channel" (PRD) ≈ "provider"/"vendor" (config) should be reconciled when the PRD is next revised.

