// Package config loads and watches the file-based vendor config.
package config

import (
	// Anchored for P1: file-based vendor config is parsed with YAML and
	// hot-reloaded via fsnotify.
	_ "github.com/fsnotify/fsnotify"
	_ "gopkg.in/yaml.v3"
)
