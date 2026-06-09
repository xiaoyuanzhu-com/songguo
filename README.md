# Songguo 松果

> Bring transparency to AI usage.

A self-hosted, single-tenant gateway that sits in front of every AI provider you use and does exactly three things: **auth, billing, observability**. It **never rewrites your traffic** — it swaps the credential, meters the call, enforces the budget, and forwards everything else untouched. One binary, your keys, your budgets, your data.

See [docs/prd.md](docs/prd.md) for the full product thinking.

---

## Why

You call many providers across many modalities, often through several resellers (号池) at once. You want one place to manage keys + budgets, see real spend, and not wake up to a runaway bill — without running a multi-tenant reseller platform or a service mesh.

Songguo is **single-tenant, multi-token**: one owner, many scoped keys. No accounts, no payment rails, no request translation. Because it's **transparent** (forwards bodies verbatim), new vendor models and fields work day one — there's no per-vendor request/response mapping to maintain.

## Features (v1)

- **Transparent proxy** for OpenAI-compatible APIs (chat, embeddings), including **SSE streaming** — forwarded chunk-by-chunk, never buffered.
- **号池 routing + failover** — multiple vendors per model and multiple credentials per vendor; priority → weighted round-robin, credential rotation, automatic failover on `429`/`5xx`.
- **Budgets & scope** per token (hard cap, allowed models, per-token RPM). Over-budget calls are rejected, not transformed.
- **Read-only metering** — usage sniffed from the native payload (with coarse fallback); a parse failure never blocks traffic. Per-model pricing yields true cost.
- **Append-only ledger** — one row per call attempt; every dashboard view is a query over it.
- **Dashboard** (light + dark, pine-green) — Overview (spend, runway, by-modality, latency percentiles, live ledger with filters + CSV/JSON export), Vendors (health + connectivity test), Tokens (CRUD with budget bars), Settings.
- **File-based vendor config with hot-reload** — edit `config.yaml`, changes apply with no restart (inotify, with an automatic polling fallback).
- **One binary.** Pure-Go SQLite (no cgo), the dashboard embedded via `go:embed`.

## Quickstart

```bash
# 1. Build (the dashboard is pre-built and committed, so Go alone is enough)
go build -o songguo ./cmd/songguo

# 2. Configure your vendors
cp config.example.yaml config.yaml   # then edit: base_url, credentials, served_models, prices

# 3. Run
export SONGGUO_ADMIN_KEY="$(openssl rand -hex 16)"   # gates the dashboard + admin API
./songguo
# -> songguo listening on :8080
```

Open the dashboard at **http://localhost:8080/** and enter the admin key. Mint a token on the **Tokens** page, then point any OpenAI-compatible SDK at the gateway, using that token as the API key:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8080/v1", api_key="sg-...")  # your Songguo token
client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
```

The call is forwarded to whichever vendor serves `gpt-4o`, metered into the ledger, and counted against the token's budget.

## Configuration

Vendors, credentials, and prices live in `config.yaml` (source of truth, hot-reloaded). Tokens live in SQLite and are managed from the dashboard. See [config.example.yaml](config.example.yaml) for the annotated schema.

```yaml
vendors:
  - name: openai-main
    base_url: https://api.openai.com      # host root (no /v1)
    served_models: [gpt-4o, text-embedding-3-small]
    priority: 1                            # lower = preferred
    weight: 1                              # weighted round-robin within a priority
    credentials:                           # the 号池 — rotated to spread per-key limits
      - { id: openai-key-1, api_key: sk-... }
    prices:
      gpt-4o: { input: 2.50, output: 10.00, unit: per_1m_tokens }
```

### Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `SONGGUO_LISTEN` | `:8080` | Listen address |
| `SONGGUO_CONFIG` | `./config.yaml` | Vendor config file (hot-reloaded) |
| `SONGGUO_DB` | `./songguo.db` | SQLite path (auto-migrated) |
| `SONGGUO_ADMIN_KEY` | _(empty)_ | Admin/dashboard key. **If empty, the admin API is unprotected** (a warning is logged). |

### Auth model

- **Admin / dashboard / `/api`** → the single `SONGGUO_ADMIN_KEY`, sent as `Authorization: Bearer <key>`.
- **Proxy traffic / `/v1`** → the per-app **tokens** you mint in the dashboard, sent by the consumer's SDK as its API key.

## Routes

| Path | Purpose |
|------|---------|
| `/v1/*` | Transparent proxy (consumer traffic) |
| `/api/*` | Admin REST API (admin-key gated) |
| `/` | Embedded dashboard |
| `/healthz` | Liveness |

## Architecture

One binary, single-tenant, SQLite by default, near-zero ops. The Ledger is the spine — an append-only table of sniffed calls. The gateway holds a live in-memory view of the file config so vendor/key/model/price changes apply without a restart. The only mutation Songguo makes to a forwarded request is swapping in the upstream credential.

```
internal/
  config/   file-based vendor config + hot-reload (watch or poll)
  store/    SQLite: append-only ledger + tokens + aggregations
  ledger/   ledger domain types
  pricing/  usage + price table -> cost
  meter/    read-only modality/usage sniffing (JSON + SSE)
  router/   号池 candidate selection, weighted RR, health/failover
  proxy/    the transparent /v1 handler
  api/      admin /api handlers
  server/   HTTP wiring (proxy, api, dashboard, health)
web/        React + Vite dashboard (built into dist/, embedded)
cmd/songguo main entrypoint
```

## Development

```bash
# Rebuild the dashboard after frontend changes (then commit web/dist)
cd web && npm install && npm run build && cd ..

go build ./...
go test ./...        # add -race for the full check
go run ./cmd/songguo
```

In dev you can run the Vite dev server (`cd web && npm run dev`) which proxies `/api` and `/v1` to a locally running `songguo`.

## Not in v1 (deferred)

Async multimodal channels (image/video submit→poll), MCP tool proxying, tag-based business attribution, and cross-model cost×latency optimization. The ledger schema already carries the fields these will use.
