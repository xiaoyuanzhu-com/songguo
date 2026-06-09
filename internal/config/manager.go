package config

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"
)

// debounceInterval coalesces the burst of events editors emit per save.
const debounceInterval = 200 * time.Millisecond

// Manager owns the live config: it loads the file, watches it via fsnotify,
// and atomically swaps in new validated Snapshots on change. A bad edit is
// logged and ignored so a running gateway is never taken down by it.
type Manager struct {
	path   string
	dir    string
	file   string
	logger *slog.Logger

	watcher *fsnotify.Watcher
	current atomic.Pointer[Snapshot]

	mu        sync.Mutex
	callbacks []func(*Snapshot)

	done   chan struct{}
	closed chan struct{}
}

// NewManager loads the config at path and starts watching it.
//
//   - Missing file: log a warning, start empty, but watch so a later-created
//     file is picked up.
//   - Existing but invalid: return an error (fail fast at startup).
//   - Valid: load it.
func NewManager(path string, logger *slog.Logger) (*Manager, error) {
	if logger == nil {
		logger = slog.Default()
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve config path %q: %w", path, err)
	}

	m := &Manager{
		path:   abs,
		dir:    filepath.Dir(abs),
		file:   filepath.Base(abs),
		logger: logger,
		done:   make(chan struct{}),
		closed: make(chan struct{}),
	}

	snap, err := LoadFile(abs)
	switch {
	case err == nil:
		m.current.Store(snap)
	case isNotExist(err):
		logger.Warn("config file not found, starting with empty config", "path", abs)
		m.current.Store(emptySnapshot())
	default:
		return nil, err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create config watcher: %w", err)
	}
	// Watch the parent directory rather than the file itself: editors that
	// save via atomic rename/replace swap the inode out from under a
	// file-level watch, which would silently stop firing.
	if err := watcher.Add(m.dir); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("watch config dir %q: %w", m.dir, err)
	}
	m.watcher = watcher

	go m.run()
	return m, nil
}

// Current returns the live snapshot. It is safe for concurrent use and never
// returns nil after construction.
func (m *Manager) Current() *Snapshot {
	return m.current.Load()
}

// OnReload registers a callback fired (synchronously, in registration order)
// after each successful reload.
func (m *Manager) OnReload(fn func(*Snapshot)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks = append(m.callbacks, fn)
}

// Close stops the watcher and its goroutine cleanly.
func (m *Manager) Close() error {
	select {
	case <-m.done:
		// already closing/closed
	default:
		close(m.done)
	}
	<-m.closed
	return m.watcher.Close()
}

// run is the single event loop. It owns the watcher's channels and the
// debounce timer, so no locking is needed for reload bookkeeping.
func (m *Manager) run() {
	defer close(m.closed)

	var timer *time.Timer
	var timerC <-chan time.Time
	arm := func() {
		if timer == nil {
			timer = time.NewTimer(debounceInterval)
		} else {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(debounceInterval)
		}
		timerC = timer.C
	}
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()

	for {
		select {
		case <-m.done:
			return

		case event, ok := <-m.watcher.Events:
			if !ok {
				return
			}
			if !m.relevant(event) {
				continue
			}
			// If our file (or its directory entry) was removed/renamed, the
			// directory watch still stands; nothing to re-arm here. Just
			// schedule a reload, which tolerates a now-missing file.
			arm()

		case err, ok := <-m.watcher.Errors:
			if !ok {
				return
			}
			m.logger.Error("config watcher error", "err", err)

		case <-timerC:
			timerC = nil
			m.reload()
		}
	}
}

// relevant reports whether an event concerns our config file.
func (m *Manager) relevant(e fsnotify.Event) bool {
	return filepath.Base(e.Name) == m.file
}

// reload re-reads and validates the file. On success it atomically swaps the
// snapshot and fires callbacks; on failure it keeps the previous snapshot and
// logs the error.
func (m *Manager) reload() {
	snap, err := LoadFile(m.path)
	if err != nil {
		if isNotExist(err) {
			m.logger.Warn("config file removed, keeping previous config", "path", m.path)
		} else {
			m.logger.Error("config reload failed, keeping previous config", "path", m.path, "err", err)
		}
		return
	}

	m.current.Store(snap)
	m.logger.Info("config reloaded", "path", m.path, "vendors", len(snap.vendors))

	m.mu.Lock()
	cbs := make([]func(*Snapshot), len(m.callbacks))
	copy(cbs, m.callbacks)
	m.mu.Unlock()

	for _, fn := range cbs {
		fn(snap)
	}
}
