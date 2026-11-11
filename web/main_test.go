package main

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func testServer(t *testing.T, queueSize int) *Server {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	if err := migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &Server{db: db, output: t.TempDir(), obsidian: "unused", queue: make(chan string, queueSize), options: fixtureOptions()}
}

func fakeObsidian(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-obsidian")
	script := `#!/bin/sh
if [ "$1" = "--home" ]; then shift 2; fi
if [ "$1" = "--printref-json" ]; then
  printf '%s\n' '{"main_build_settings":{"game":{"values":["doom2"]}}}'
  exit 0
fi
if [ -n "$OBSIDIAN_HELPER_RECORD" ]; then printf '%s\n' "$@" > "$OBSIDIAN_HELPER_RECORD"; fi
echo 'simulated generator output'
if [ "$OBSIDIAN_HELPER_MODE" = "fail" ]; then echo 'simulated generator failure' >&2; exit 7; fi
if [ "$OBSIDIAN_HELPER_MODE" != "no-output" ]; then
  previous=""
  for arg in "$@"; do
    if [ "$previous" = "--batch" ]; then printf 'IWAD-TEST' > "$arg"; fi
    previous="$arg"
  done
fi
exit 0
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func fixtureOptions() map[string]map[string]map[string]json.RawMessage {
	return map[string]map[string]map[string]json.RawMessage{
		"main_build_settings": {
			"game":   rawObject(`{"values":["doom1","doom2","ultdoom"]}`),
			"port":   rawObject(`{"values":["boom","zdoom"]}`),
			"theme":  rawObject(`{"values":["original","tech"]}`),
			"length": rawObject(`{"values":["single","game"]}`),
		},
		"architecture": {
			"float_size": rawObject(`{"type":"slider","values":{"min":1,"max":9,"default":5,"nan":["mixed"]}}`),
			"walls":      rawObject(`{"type":"choice","values":["brick","metal"]}`),
			"enabled":    rawObject(`{"type":"boolean","default":1}`),
		},
	}
}

func rawObject(s string) map[string]json.RawMessage {
	var value map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &value); err != nil {
		panic(err)
	}
	return value
}

func postJob(s *Server, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/jobs", strings.NewReader(body))
	w := httptest.NewRecorder()
	s.jobs(w, r)
	return w
}

func validJobJSON() string {
	return `{"game":"doom2","port":"boom","theme":"original","length":"game","seed":"abc","options":{"float_size":"8","walls":"brick"}}`
}

func TestMigrateAppliesStaticSQLOnceAndIsIdempotent(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "migration.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("got %d applied migrations; want 2", count)
	}
	var exists int
	if err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='jobs'`).Scan(&exists); err != nil || exists != 1 {
		t.Fatalf("jobs table missing (exists=%d, err=%v)", exists, err)
	}
}

func TestValidateOption(t *testing.T) {
	cases := []struct {
		name       string
		definition map[string]json.RawMessage
		value      string
		wantErr    bool
	}{
		{"valid choice", rawObject(`{"values":["a","b"]}`), "a", false},
		{"invalid choice", rawObject(`{"values":["a","b"]}`), "c", true},
		{"valid main choice", rawObject(`{"choices":["doom1","doom2"]}`), "doom2", false},
		{"invalid main choice", rawObject(`{"choices":["doom1","doom2"]}`), "strife", true},
		{"valid slider", rawObject(`{"type":"slider","values":{"min":1,"max":9,"nan":["mixed"]}}`), "8", false},
		{"valid slider special", rawObject(`{"type":"slider","values":{"min":1,"max":9,"nan":["mixed"]}}`), "mixed", false},
		{"invalid slider", rawObject(`{"type":"slider","values":{"min":1,"max":9,"nan":["mixed"]}}`), "10", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOption(tc.definition, tc.value)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateOption() error=%v, wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

func TestCreateJobPersistsRequestAndQueuesID(t *testing.T) {
	s := testServer(t, 1)
	w := postJob(s, validJobJSON())
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var response Job
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ID == "" || response.Status != "queued" {
		t.Fatalf("unexpected response: %+v", response)
	}
	if got := <-s.queue; got != response.ID {
		t.Fatalf("queued id=%q, want %q", got, response.ID)
	}
	var raw string
	if err := s.db.QueryRow(`SELECT request_json FROM jobs WHERE id=?`, response.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var saved CreateJob
	if err := json.Unmarshal([]byte(raw), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Options["float_size"] != "8" || saved.Seed != "abc" || saved.Port != "boom" {
		t.Fatalf("request not persisted: %+v", saved)
	}
	w = httptest.NewRecorder()
	s.jobs(w, httptest.NewRequest(http.MethodGet, "/api/jobs", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"settings":{"game":"doom2"`) || !strings.Contains(w.Body.String(), `"float_size":"8"`) {
		t.Fatalf("job list missing reusable settings: status=%d body=%s", w.Code, w.Body)
	}
}

func TestCreateJobRejectsMalformedOrInvalidRequests(t *testing.T) {
	cases := []struct{ name, body string }{
		{"malformed JSON", `{`},
		{"unknown field", `{"game":"doom2","unknown":true}`},
		{"invalid game", `{"game":"strife","port":"boom","theme":"original","length":"game"}`},
		{"invalid port", `{"game":"doom2","port":"edge","theme":"original","length":"game"}`},
		{"invalid theme", `{"game":"doom2","port":"boom","theme":"hell","length":"game"}`},
		{"invalid length", `{"game":"doom2","port":"boom","theme":"original","length":"episode"}`},
		{"unknown option", `{"game":"doom2","port":"boom","theme":"original","length":"game","options":{"not_real":"x"}}`},
		{"invalid option choice", `{"game":"doom2","port":"boom","theme":"original","length":"game","options":{"walls":"wood"}}`},
		{"slider out of range", `{"game":"doom2","port":"boom","theme":"original","length":"game","options":{"float_size":"20"}}`},
		{"newline in seed", `{"game":"doom2","port":"boom","theme":"original","length":"game","seed":"x\ny"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := testServer(t, 2)
			w := postJob(s, tc.body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

func TestCreateJobRejectsOversizedPayloadAndFullQueue(t *testing.T) {
	t.Run("oversized", func(t *testing.T) {
		s := testServer(t, 1)
		w := postJob(s, `{"padding":"`+strings.Repeat("x", 70000)+`"}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status=%d", w.Code)
		}
	})
	t.Run("full queue", func(t *testing.T) {
		s := testServer(t, 0)
		w := postJob(s, validJobJSON())
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status=%d", w.Code)
		}
		var status string
		if err := s.db.QueryRow(`SELECT status FROM jobs`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != "failed" {
			t.Fatalf("job status=%q, want failed", status)
		}
	})
}

func TestJobsAndOptionsHandlers(t *testing.T) {
	s := testServer(t, 2)
	get := httptest.NewRecorder()
	s.jobs(get, httptest.NewRequest(http.MethodGet, "/api/jobs", nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "[]") {
		t.Fatalf("GET jobs: %d %s", get.Code, get.Body)
	}
	method := httptest.NewRecorder()
	s.jobs(method, httptest.NewRequest(http.MethodDelete, "/api/jobs", nil))
	if method.Code != http.StatusMethodNotAllowed {
		t.Fatalf("jobs method status=%d", method.Code)
	}
	options := httptest.NewRecorder()
	s.optionReference(options, httptest.NewRequest(http.MethodGet, "/api/options", nil))
	if options.Code != http.StatusOK || !strings.Contains(options.Body.String(), "main_build_settings") {
		t.Fatalf("GET options: %d %s", options.Code, options.Body)
	}
	method = httptest.NewRecorder()
	s.optionReference(method, httptest.NewRequest(http.MethodPost, "/api/options", nil))
	if method.Code != http.StatusMethodNotAllowed {
		t.Fatalf("options method status=%d", method.Code)
	}
}

func TestJobsPaginationLimitsAndOffsets(t *testing.T) {
	s := testServer(t, 4)
	for i, id := range []string{"oldest", "middle", "newest"} {
		created := time.Date(2026, 1, 1, 0, i, 0, 0, time.UTC).Format(time.RFC3339)
		if _, err := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at,request_json) VALUES(?,?,?,?,?)`, id, "completed", created, created, validJobJSON()); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(s.output, "middle.wad"), []byte("PWAD"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"?limit=2", []string{"newest", "middle"}},
		{"?limit=2&offset=1", []string{"middle", "oldest"}},
		{"?limit=500", []string{"newest", "middle", "oldest"}},
	} {
		w := httptest.NewRecorder()
		s.jobs(w, httptest.NewRequest(http.MethodGet, "/api/jobs"+tc.query, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: status=%d body=%s", tc.query, w.Code, w.Body)
		}
		var jobs []Job
		if err := json.Unmarshal(w.Body.Bytes(), &jobs); err != nil {
			t.Fatal(err)
		}
		if len(jobs) != len(tc.want) {
			t.Fatalf("GET %s: got %d jobs, want %d", tc.query, len(jobs), len(tc.want))
		}
		for i, want := range tc.want {
			if jobs[i].ID != want {
				t.Errorf("GET %s job[%d]=%q, want %q", tc.query, i, jobs[i].ID, want)
			}
			if jobs[i].ID == "middle" && jobs[i].File != "/api/jobs/middle/download" {
				t.Errorf("GET %s middle file=%q, want its download URL", tc.query, jobs[i].File)
			}
			if jobs[i].ID != "middle" && jobs[i].File != "" {
				t.Errorf("GET %s %s unexpectedly has download URL %q without a WAD", tc.query, jobs[i].ID, jobs[i].File)
			}
		}
	}
	for _, query := range []string{"?limit=0", "?limit=nope", "?offset=-1", "?offset=1000001"} {
		w := httptest.NewRecorder()
		s.jobs(w, httptest.NewRequest(http.MethodGet, "/api/jobs"+query, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("GET %s: status=%d, want 400", query, w.Code)
		}
	}
}

func TestReadOptionsParsesObsidianReference(t *testing.T) {
	s := testServer(t, 1)
	t.Setenv("OBSIDIAN_HOME", t.TempDir())
	s.obsidian = fakeObsidian(t)
	refs, err := s.readOptions()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := findOption(refs, "game"); !ok {
		t.Fatal("reference has no game option")
	}
}

func TestJobStatusAndDownload(t *testing.T) {
	s := testServer(t, 1)
	now := time.Now().UTC().Format(time.RFC3339)
	id := "12345"
	if _, err := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at) VALUES(?,?,?,?)`, id, "queued", now, now); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/"+id, nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"queued"`) {
		t.Fatalf("queued status: %d %s", w.Code, w.Body)
	}
	logText := "starting generator\nplacing rooms\n"
	if err := os.WriteFile(filepath.Join(s.output, id+".log"), []byte(logText), 0600); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/"+id+"/logs", nil))
	if w.Code != http.StatusOK || w.Body.String() != logText || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("job logs: status=%d type=%q body=%q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/missing", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodPost, "/api/jobs/"+id, nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("job method status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/"+id+"/download", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("not-ready download status=%d", w.Code)
	}
	if err := os.WriteFile(filepath.Join(s.output, id+".wad"), []byte("PWADDATA"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE jobs SET status='completed' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/"+id, nil))
	if !strings.Contains(w.Body.String(), "/download") {
		t.Fatalf("completed job has no download URL: %s", w.Body)
	}
	w = httptest.NewRecorder()
	s.job(w, httptest.NewRequest(http.MethodGet, "/api/jobs/"+id+"/download", nil))
	if w.Code != http.StatusOK || w.Body.String() != "PWADDATA" {
		t.Fatalf("download: %d %q", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), id) {
		t.Fatalf("missing filename header: %q", w.Header().Get("Content-Disposition"))
	}
}

func TestExtractWADFromObsidianZip(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "bundle.zip")
	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	if _, err = archive.Create("README.txt"); err != nil {
		t.Fatal(err)
	}
	entry, err := archive.Create("nested/level.wad")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte("PWAD-generated")); err != nil {
		t.Fatal(err)
	}
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "direct-download.wad")
	if err = extractWADFromZip(zipPath, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "PWAD-generated" {
		t.Fatalf("extracted WAD=%q err=%v", got, err)
	}
}

func TestRecoverBundledWADMarksSuccessfulFailedRunComplete(t *testing.T) {
	s := testServer(t, 1)
	id := "recovery-1"
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at,error,request_json) VALUES(?,?,?,?,?,?)`, id, "failed", now, now, "missing WAD", validJobJSON()); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.output, id+".log"), []byte("Obsidian\nSuccess\n"), 0600); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(s.output, id+".zip")
	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create("generated.wad")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("PWAD-recovered")); err != nil {
		t.Fatal(err)
	}
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := recoverBundledWADs(s.db, s.output); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := s.db.QueryRow(`SELECT status FROM jobs WHERE id=?`, id).Scan(&status); err != nil || status != "completed" {
		t.Fatalf("recovered status=%q err=%v", status, err)
	}
	if _, err := os.Stat(filepath.Join(s.output, id+".wad")); err != nil {
		t.Fatalf("recovered WAD missing: %v", err)
	}
	if _, err := os.Stat(zipPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("recovered ZIP still exists: err=%v", err)
	}
}

func TestWorkerGeneratesAndRecordsWAD(t *testing.T) {
	s := testServer(t, 1)
	home := t.TempDir()
	t.Setenv("OBSIDIAN_HOME", home)
	record := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("OBSIDIAN_HELPER_RECORD", record)
	s.obsidian = fakeObsidian(t)
	id := "job-1"
	request := CreateJob{Game: "doom2", Port: "boom", Theme: "original", Length: "game", Seed: "test-seed", Options: map[string]string{"float_size": "8"}}
	encoded, _ := json.Marshal(request)
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at,request_json) VALUES(?,?,?,?,?)`, id, "queued", now, now, string(encoded)); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { s.worker(); close(done) }()
	s.queue <- id
	close(s.queue)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not finish")
	}
	var status string
	if err := s.db.QueryRow(`SELECT status FROM jobs WHERE id=?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("status=%s", status)
	}
	wad, err := os.ReadFile(filepath.Join(s.output, id+".wad"))
	if err != nil || string(wad) != "IWAD-TEST" {
		t.Fatalf("wad=%q err=%v", wad, err)
	}
	logOutput, err := os.ReadFile(filepath.Join(s.output, id+".log"))
	if err != nil || !strings.Contains(string(logOutput), "simulated generator output") {
		t.Fatalf("job log=%q err=%v", logOutput, err)
	}
	argsBytes, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Split(strings.TrimSpace(string(argsBytes)), "\n")
	joined := strings.Join(args, " ")
	for _, expected := range []string{"--batch", filepath.Join(s.output, id+".wad"), "game=doom2", "port=boom", "float_size=8", "seed=test-seed"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("worker args missing %q: %v", expected, args)
		}
	}
}

func TestWorkerFailsWhenGeneratorFailsOrOmitsWAD(t *testing.T) {
	for _, mode := range []string{"fail", "no-output"} {
		t.Run(mode, func(t *testing.T) {
			s := testServer(t, 1)
			t.Setenv("OBSIDIAN_HOME", t.TempDir())
			t.Setenv("OBSIDIAN_HELPER_MODE", mode)
			s.obsidian = fakeObsidian(t)
			id := "failure"
			raw, _ := json.Marshal(CreateJob{Game: "doom2", Port: "boom", Theme: "original", Length: "game"})
			now := time.Now().UTC().Format(time.RFC3339)
			_, err := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at,request_json) VALUES(?,?,?,?,?)`, id, "queued", now, now, string(raw))
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan struct{})
			go func() { s.worker(); close(done) }()
			s.queue <- id
			close(s.queue)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("worker did not finish")
			}
			var status, message string
			if err = s.db.QueryRow(`SELECT status,error FROM jobs WHERE id=?`, id).Scan(&status, &message); err != nil {
				t.Fatal(err)
			}
			if status != "failed" || message == "" {
				t.Fatalf("status=%q error=%q", status, message)
			}
		})
	}
}
