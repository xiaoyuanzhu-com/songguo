package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// maxRequestBody bounds the JSON request body size for admin writes.
const maxRequestBody = 1 << 20 // 1 MiB

// decodeJSON decodes the (bounded) request body into v, rejecting unknown
// fields. An empty body is treated as an empty object so optional-field PATCH
// bodies are valid.
func decodeJSON(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxRequestBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		if err == io.EOF {
			return nil
		}
		return err
	}
	return nil
}

// serverError logs the underlying error (which may reference internals) and
// returns a generic 500 to the client so details never leak.
func (a *api) serverError(w http.ResponseWriter, op string, err error) {
	a.logger.Error("admin api error", "op", op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "internal error")
}

// originOf returns the scheme://host of a base URL, stripping any path. The
// vendor connectivity probe targets the origin because base_url now carries a
// vendor-specific path prefix that may not expose an OpenAI-style route.
func originOf(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("parse base_url %q: %w", base, err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("base_url %q missing scheme or host", base)
	}
	return u.Scheme + "://" + u.Host, nil
}

// contextWithTimeout derives a timeout context from the request context.
func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}

// drain discards and closes a response body so the connection can be reused.
func drain(body io.ReadCloser) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, body)
}
