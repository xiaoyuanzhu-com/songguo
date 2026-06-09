// Package server provides the HTTP server that fronts the gateway and admin API.
package server

import (
	"context"
	"encoding/json"
	"net/http"
)

// Options configures a Server.
type Options struct {
	// Addr is the listen address, e.g. ":8080".
	Addr string
}

// Server wraps an *http.Server and its route mux.
type Server struct {
	httpServer *http.Server
	mux        *http.ServeMux
}

// New constructs a Server and registers its routes.
func New(cfg Options) *Server {
	mux := http.NewServeMux()
	s := &Server{
		mux: mux,
		httpServer: &http.Server{
			Addr:    cfg.Addr,
			Handler: mux,
		},
	}
	s.registerRoutes()
	return s
}

// registerRoutes wires up the HTTP routes.
func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /healthz", handleHealthz)
	// TODO(P3): mount the transparent proxy handler.
	// TODO(P4): mount the admin/dashboard API under /admin.
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Start runs the HTTP server until it is shut down or fails.
func (s *Server) Start() error {
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
