package store

import (
	"testing"
)

func TestProviderCRUDRoundTrip(t *testing.T) {
	s := openTestStore(t)

	pvd, err := s.CreateProvider(NewProvider{
		Name:     "openai",
		Vendor:   "OpenAI",
		Adapter:  "openai-compatible",
		BaseURL:  "https://api.openai.com/v1",
		Priority: 1,
		Weight:   2,
		Enabled:  true,
		APIKey:   "sk-aaa",
		Models: []ProviderModel{
			{Model: "gpt-4o", Input: 2.5, Output: 10, Unit: "per_1m_tokens"},
			{Model: "gpt-4o-mini", Input: 0.15, Output: 0.6, Unit: "per_1m_tokens"},
		},
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if pvd.ID == "" {
		t.Fatal("expected generated provider id")
	}
	if pvd.APIKey != "sk-aaa" {
		t.Fatalf("api key = %q, want sk-aaa", pvd.APIKey)
	}
	if len(pvd.Models) != 2 {
		t.Fatalf("models = %d, want 2", len(pvd.Models))
	}
	if pvd.Weight != 2 {
		t.Errorf("weight = %d, want 2", pvd.Weight)
	}

	// Duplicate name must fail (UNIQUE).
	if _, err := s.CreateProvider(NewProvider{Name: "openai", BaseURL: "https://x.example.com"}); err == nil {
		t.Error("expected duplicate name to fail")
	}

	// Update scalar + replace models.
	newName := "openai-main"
	disabled := false
	updated, err := s.UpdateProvider(pvd.ID, ProviderUpdate{
		Name:    &newName,
		Enabled: &disabled,
		Models:  []ProviderModel{{Model: "gpt-4o", Input: 3, Output: 12, Unit: "per_1m_tokens"}},
	})
	if err != nil {
		t.Fatalf("UpdateProvider: %v", err)
	}
	if updated.Name != "openai-main" {
		t.Errorf("name = %q, want openai-main", updated.Name)
	}
	if updated.Enabled {
		t.Error("expected disabled")
	}
	if len(updated.Models) != 1 || updated.Models[0].Input != 3 {
		t.Errorf("models not replaced: %+v", updated.Models)
	}

	// Replace the API key.
	newKey := "sk-ccc"
	updated, err = s.UpdateProvider(pvd.ID, ProviderUpdate{APIKey: &newKey})
	if err != nil {
		t.Fatalf("UpdateProvider(api key): %v", err)
	}
	if updated.APIKey != "sk-ccc" {
		t.Fatalf("api key after replace = %q, want sk-ccc", updated.APIKey)
	}

	// List + count.
	if n, _ := s.CountProviders(); n != 1 {
		t.Errorf("CountProviders = %d, want 1", n)
	}
	list, err := s.ListProviders()
	if err != nil {
		t.Fatalf("ListProviders: %v", err)
	}
	if len(list) != 1 || list[0].APIKey != "sk-ccc" || len(list[0].Models) != 1 {
		t.Errorf("ListProviders assembly wrong: %+v", list)
	}

	// Delete cascades.
	if err := s.DeleteProvider(pvd.ID); err != nil {
		t.Fatalf("DeleteProvider: %v", err)
	}
	if _, err := s.GetProvider(pvd.ID); err == nil {
		t.Error("expected provider gone")
	}
	if n, _ := s.CountProviders(); n != 0 {
		t.Errorf("CountProviders after delete = %d, want 0", n)
	}
}

func TestAppSettingsRoundTrip(t *testing.T) {
	s := openTestStore(t)

	as, err := s.GetAppSettings()
	if err != nil {
		t.Fatalf("GetAppSettings: %v", err)
	}
	if as.Capture {
		t.Error("capture should default off")
	}
	if as.CaptureMaxBytes != 32768 || as.CaptureRetain != 10000 {
		t.Errorf("defaults wrong: %+v", as)
	}

	if err := s.UpdateAppSettings(AppSettings{Capture: true, CaptureMaxBytes: 1000, CaptureRetain: 50}); err != nil {
		t.Fatalf("UpdateAppSettings: %v", err)
	}
	as, _ = s.GetAppSettings()
	if !as.Capture || as.CaptureMaxBytes != 1000 || as.CaptureRetain != 50 {
		t.Errorf("settings not persisted: %+v", as)
	}
}

// TestWireBackfillOnMigration simulates a database that predates the
// provider_wires table: when migrate() creates the table on a DB that already
// has providers, those providers must be granted the default allowlist for
// their adapter (or they would silently deny all traffic after the upgrade).
func TestWireBackfillOnMigration(t *testing.T) {
	s := openTestStore(t)

	openaiPvd, err := s.CreateProvider(NewProvider{
		Name: "legacy-openai", Adapter: "openai-compatible", BaseURL: "https://x.example.com",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	anthroPvd, err := s.CreateProvider(NewProvider{
		Name: "legacy-anthropic", Adapter: "anthropic-compatible", BaseURL: "https://y.example.com",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	// Rewind to the pre-wire era, then re-run migrations as a restart would.
	if _, err := s.db.Exec(`DELETE FROM provider_wires WHERE provider_id = ?`, openaiPvd.ID); err != nil {
		t.Fatalf("clear openai wires: %v", err)
	}
	if _, err := s.db.Exec(`DELETE FROM provider_wires WHERE provider_id = ?`, anthroPvd.ID); err != nil {
		t.Fatalf("clear anthropic wires: %v", err)
	}
	if _, err := s.db.Exec(`DROP TABLE provider_wires`); err != nil {
		t.Fatalf("drop provider_wires: %v", err)
	}
	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetProvider(openaiPvd.ID)
	if err != nil {
		t.Fatalf("GetProvider: %v", err)
	}
	if len(got.Wires) == 0 || !containsStr(got.Wires, "openai/chat") {
		t.Errorf("openai provider wires = %v, want openai defaults", got.Wires)
	}

	got, err = s.GetProvider(anthroPvd.ID)
	if err != nil {
		t.Fatalf("GetProvider: %v", err)
	}
	if !containsStr(got.Wires, "anthropic/messages") || containsStr(got.Wires, "openai/chat") {
		t.Errorf("anthropic provider wires = %v, want anthropic defaults", got.Wires)
	}

	// Re-running migrate with the table present must NOT re-add dropped wires.
	if _, err := s.db.Exec(`DELETE FROM provider_wires WHERE provider_id = ?`, openaiPvd.ID); err != nil {
		t.Fatalf("clear wires: %v", err)
	}
	if err := s.migrate(); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	got, err = s.GetProvider(openaiPvd.ID)
	if err != nil {
		t.Fatalf("GetProvider: %v", err)
	}
	if len(got.Wires) != 0 {
		t.Errorf("wires re-added on idempotent migrate: %v", got.Wires)
	}
}

// TestCredentialPoolFoldOnMigration simulates a database from the multi-key
// pool era: when migrate() finds a service_credentials table, each provider's
// oldest key must be folded into providers.api_key and the table dropped.
func TestCredentialPoolFoldOnMigration(t *testing.T) {
	s := openTestStore(t)

	pvd, err := s.CreateProvider(NewProvider{
		Name: "legacy", BaseURL: "https://x.example.com",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	// Rewind to the pool era: recreate the table with two keys, oldest first.
	stmts := []string{
		`CREATE TABLE service_credentials (
			id TEXT PRIMARY KEY,
			service_id TEXT NOT NULL,
			api_key TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`INSERT INTO service_credentials VALUES ('c1', '` + pvd.ID + `', 'sk-old', 100)`,
		`INSERT INTO service_credentials VALUES ('c2', '` + pvd.ID + `', 'sk-new', 200)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetProvider(pvd.ID)
	if err != nil {
		t.Fatalf("GetProvider: %v", err)
	}
	if got.APIKey != "sk-old" {
		t.Errorf("api_key = %q, want oldest pool key sk-old", got.APIKey)
	}
	if ok, _ := s.tableExists("service_credentials"); ok {
		t.Error("service_credentials table should be dropped after fold")
	}
}

// TestServicesRenameOnMigration simulates a services-era database and verifies
// migrate() renames every table and column to the providers naming with data
// intact.
func TestServicesRenameOnMigration(t *testing.T) {
	s := openTestStore(t)

	pvd, err := s.CreateProvider(NewProvider{
		Name: "legacy", BaseURL: "https://x.example.com",
		Models: []ProviderModel{{Model: "m1", Input: 1, Output: 2}},
		Wires:  []string{"openai/chat"},
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	// Rewind to the services era: old table and column names.
	stmts := []string{
		`PRAGMA legacy_alter_table=ON`,
		`ALTER TABLE providers RENAME TO services`,
		`ALTER TABLE provider_models RENAME TO service_models`,
		`ALTER TABLE service_models RENAME COLUMN provider_id TO service_id`,
		`ALTER TABLE provider_wires RENAME TO service_wires`,
		`ALTER TABLE service_wires RENAME COLUMN provider_id TO service_id`,
		`PRAGMA legacy_alter_table=OFF`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("setup %s: %v", q, err)
		}
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetProvider(pvd.ID)
	if err != nil {
		t.Fatalf("GetProvider after rename: %v", err)
	}
	if len(got.Models) != 1 || got.Models[0].Model != "m1" {
		t.Errorf("models = %v, want m1 preserved", got.Models)
	}
	if !containsStr(got.Wires, "openai/chat") {
		t.Errorf("wires = %v, want openai/chat preserved", got.Wires)
	}
	for _, old := range []string{"services", "service_models", "service_wires"} {
		if ok, _ := s.tableExists(old); ok {
			t.Errorf("table %s should be gone after rename", old)
		}
	}
}

// TestServicesRenameRepairsInterruptedMigration simulates the state a buggy
// earlier rename left behind: services and service_models already renamed but
// provider_models still has the service_id column, service_wires never renamed,
// and an empty provider_wires created by CREATE TABLE IF NOT EXISTS on a later
// failed run. migrate() must repair all of it.
func TestServicesRenameRepairsInterruptedMigration(t *testing.T) {
	s := openTestStore(t)

	pvd, err := s.CreateProvider(NewProvider{
		Name: "legacy", BaseURL: "https://x.example.com",
		Models: []ProviderModel{{Model: "m1", Input: 1, Output: 2}},
		Wires:  []string{"openai/chat"},
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	stmts := []string{
		`PRAGMA legacy_alter_table=ON`,
		`ALTER TABLE provider_models RENAME COLUMN provider_id TO service_id`,
		`ALTER TABLE provider_wires RENAME TO service_wires`,
		`ALTER TABLE service_wires RENAME COLUMN provider_id TO service_id`,
		`PRAGMA legacy_alter_table=OFF`,
		// The interrupted run's CREATE TABLE IF NOT EXISTS made a fresh empty one.
		`CREATE TABLE provider_wires (
			provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
			wire        TEXT NOT NULL,
			PRIMARY KEY (provider_id, wire)
		)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("setup %s: %v", q, err)
		}
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetProvider(pvd.ID)
	if err != nil {
		t.Fatalf("GetProvider after repair: %v", err)
	}
	if len(got.Models) != 1 || got.Models[0].Model != "m1" {
		t.Errorf("models = %v, want m1 preserved", got.Models)
	}
	if !containsStr(got.Wires, "openai/chat") {
		t.Errorf("wires = %v, want openai/chat folded back from service_wires", got.Wires)
	}
	if ok, _ := s.tableExists("service_wires"); ok {
		t.Error("service_wires should be dropped after fold")
	}
	if ok, _ := s.hasColumn("provider_models", "service_id"); ok {
		t.Error("provider_models.service_id should be renamed to provider_id")
	}
}

func containsStr(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
