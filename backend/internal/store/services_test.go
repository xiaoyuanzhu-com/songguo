package store

import (
	"testing"
)

func TestServiceCRUDRoundTrip(t *testing.T) {
	s := openTestStore(t)

	svc, err := s.CreateService(NewService{
		Name:     "openai",
		Vendor:   "OpenAI",
		Adapter:  "openai-compatible",
		BaseURL:  "https://api.openai.com/v1",
		Priority: 1,
		Weight:   2,
		Enabled:  true,
		APIKey:   "sk-aaa",
		Models: []ServiceModel{
			{Model: "gpt-4o", Input: 2.5, Output: 10, Unit: "per_1m_tokens"},
			{Model: "gpt-4o-mini", Input: 0.15, Output: 0.6, Unit: "per_1m_tokens"},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if svc.ID == "" {
		t.Fatal("expected generated service id")
	}
	if svc.APIKey != "sk-aaa" {
		t.Fatalf("api key = %q, want sk-aaa", svc.APIKey)
	}
	if len(svc.Models) != 2 {
		t.Fatalf("models = %d, want 2", len(svc.Models))
	}
	if svc.Weight != 2 {
		t.Errorf("weight = %d, want 2", svc.Weight)
	}

	// Duplicate name must fail (UNIQUE).
	if _, err := s.CreateService(NewService{Name: "openai", BaseURL: "https://x.example.com"}); err == nil {
		t.Error("expected duplicate name to fail")
	}

	// Update scalar + replace models.
	newName := "openai-main"
	disabled := false
	updated, err := s.UpdateService(svc.ID, ServiceUpdate{
		Name:    &newName,
		Enabled: &disabled,
		Models:  []ServiceModel{{Model: "gpt-4o", Input: 3, Output: 12, Unit: "per_1m_tokens"}},
	})
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
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
	updated, err = s.UpdateService(svc.ID, ServiceUpdate{APIKey: &newKey})
	if err != nil {
		t.Fatalf("UpdateService(api key): %v", err)
	}
	if updated.APIKey != "sk-ccc" {
		t.Fatalf("api key after replace = %q, want sk-ccc", updated.APIKey)
	}

	// List + count.
	if n, _ := s.CountServices(); n != 1 {
		t.Errorf("CountServices = %d, want 1", n)
	}
	list, err := s.ListServices()
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if len(list) != 1 || list[0].APIKey != "sk-ccc" || len(list[0].Models) != 1 {
		t.Errorf("ListServices assembly wrong: %+v", list)
	}

	// Delete cascades.
	if err := s.DeleteService(svc.ID); err != nil {
		t.Fatalf("DeleteService: %v", err)
	}
	if _, err := s.GetService(svc.ID); err == nil {
		t.Error("expected service gone")
	}
	if n, _ := s.CountServices(); n != 0 {
		t.Errorf("CountServices after delete = %d, want 0", n)
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
// service_wires table: when migrate() creates the table on a DB that already
// has services, those services must be granted the default allowlist for
// their adapter (or they would silently deny all traffic after the upgrade).
func TestWireBackfillOnMigration(t *testing.T) {
	s := openTestStore(t)

	openaiSvc, err := s.CreateService(NewService{
		Name: "legacy-openai", Adapter: "openai-compatible", BaseURL: "https://x.example.com",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	anthroSvc, err := s.CreateService(NewService{
		Name: "legacy-anthropic", Adapter: "anthropic-compatible", BaseURL: "https://y.example.com",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	// Rewind to the pre-wire era, then re-run migrations as a restart would.
	if _, err := s.db.Exec(`DROP TABLE service_wires`); err != nil {
		t.Fatalf("drop service_wires: %v", err)
	}
	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetService(openaiSvc.ID)
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if len(got.Wires) == 0 || !containsStr(got.Wires, "openai/chat") {
		t.Errorf("openai service wires = %v, want openai defaults", got.Wires)
	}

	got, err = s.GetService(anthroSvc.ID)
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if !containsStr(got.Wires, "anthropic/messages") || containsStr(got.Wires, "openai/chat") {
		t.Errorf("anthropic service wires = %v, want anthropic defaults", got.Wires)
	}

	// Re-running migrate with the table present must NOT re-add dropped wires.
	if _, err := s.db.Exec(`DELETE FROM service_wires WHERE service_id = ?`, openaiSvc.ID); err != nil {
		t.Fatalf("clear wires: %v", err)
	}
	if err := s.migrate(); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	got, err = s.GetService(openaiSvc.ID)
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if len(got.Wires) != 0 {
		t.Errorf("wires re-added on idempotent migrate: %v", got.Wires)
	}
}

// TestCredentialPoolFoldOnMigration simulates a database from the multi-key
// pool era: when migrate() finds a service_credentials table, each service's
// oldest key must be folded into services.api_key and the table dropped.
func TestCredentialPoolFoldOnMigration(t *testing.T) {
	s := openTestStore(t)

	svc, err := s.CreateService(NewService{
		Name: "legacy", BaseURL: "https://x.example.com",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	// Rewind to the pool era: recreate the table with two keys, oldest first.
	stmts := []string{
		`CREATE TABLE service_credentials (
			id TEXT PRIMARY KEY,
			service_id TEXT NOT NULL,
			api_key TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`INSERT INTO service_credentials VALUES ('c1', '` + svc.ID + `', 'sk-old', 100)`,
		`INSERT INTO service_credentials VALUES ('c2', '` + svc.ID + `', 'sk-new', 200)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.GetService(svc.ID)
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if got.APIKey != "sk-old" {
		t.Errorf("api_key = %q, want oldest pool key sk-old", got.APIKey)
	}
	if ok, _ := s.tableExists("service_credentials"); ok {
		t.Error("service_credentials table should be dropped after fold")
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
