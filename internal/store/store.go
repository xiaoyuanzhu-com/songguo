// Package store persists tokens, budgets, and usage in SQLite.
package store

import (
	// Anchored for P2: storage uses the pure-Go (cgo-free) SQLite driver so
	// the gateway ships as a single static binary.
	_ "modernc.org/sqlite"
)
