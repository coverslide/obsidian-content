package main

import (
	"archive/zip"
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed migrations/*.sql embedded
var assets embed.FS

type Server struct {
	db               *sql.DB
	output, obsidian string
	queue            chan string
	options          map[string]map[string]map[string]json.RawMessage
}
type CreateJob struct {
	Game    string            `json:"game"`
	Port    string            `json:"port"`
	Theme   string            `json:"theme"`
	Length  string            `json:"length"`
	Seed    string            `json:"seed"`
	Options map[string]string `json:"options"`
}
type Job struct {
	ID        string     `json:"id"`
	Status    string     `json:"status"`
	CreatedAt string     `json:"createdAt"`
	UpdatedAt string     `json:"updatedAt"`
	Error     string     `json:"error,omitempty"`
	File      string     `json:"file,omitempty"`
	Settings  *CreateJob `json:"settings,omitempty"`
}

func main() {
	dbPath := env("DATABASE_PATH", "/data/jobs.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	if err = migrate(db); err != nil {
		log.Fatal(err)
	}
	_, _ = db.Exec(`UPDATE jobs SET status='failed',error='Service restarted while job was running' WHERE status='running'`)
	out := env("WAD_DIR", "/wads")
	if err := os.MkdirAll(out, 0755); err != nil {
		log.Fatal(err)
	}
	if err := recoverBundledWADs(db, out); err != nil {
		log.Printf("recover completed WADs: %v", err)
	}
	s := &Server{db: db, output: out, obsidian: env("OBSIDIAN_BIN", "/opt/obsidian/obsidian"), queue: make(chan string, 100)}
	s.options, err = s.readOptions()
	if err != nil {
		log.Fatalf("load Obsidian option reference: %v", err)
	}
	rows, e := db.Query(`SELECT id FROM jobs WHERE status='queued' ORDER BY created_at`)
	if e != nil {
		log.Fatal(e)
	}
	var pending []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			pending = append(pending, id)
		}
	}
	_ = rows.Close()
	for _, id := range pending {
		s.queue <- id
	}
	go s.worker()
	mux := http.NewServeMux()
	staticFiles, err := fs.Sub(assets, "embedded")
	if err != nil {
		log.Fatal(err)
	}
	mux.HandleFunc("/api/jobs", s.jobs)
	mux.HandleFunc("/api/options", s.optionReference)
	mux.HandleFunc("/api/jobs/", s.job)
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".data", "application/octet-stream")
	mux.Handle("/play/", http.StripPrefix("/play/", http.FileServer(http.Dir(env("UZDOOM_WEB_DIR", "/opt/uzdoom-player")))))
	mux.Handle("/", http.FileServer(http.FS(staticFiles)))
	addr := env("ADDR", ":8080")
	log.Printf("obsidian-web listening on %s", addr)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		mux.ServeHTTP(w, r)
	})
	log.Fatal(http.ListenAndServe(addr, handler))
}
func (s *Server) jobs(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		limit, offset := 100, 0
		if value := r.URL.Query().Get("limit"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 {
				http.Error(w, "invalid limit", http.StatusBadRequest)
				return
			}
			limit = parsed
		}
		if limit > 101 {
			limit = 101
		}
		if value := r.URL.Query().Get("offset"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 0 || parsed > 1000000 {
				http.Error(w, "invalid offset", http.StatusBadRequest)
				return
			}
			offset = parsed
		}
		rows, e := s.db.Query(`SELECT id,status,created_at,updated_at,error,request_json FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		defer rows.Close()
		list := []Job{}
		for rows.Next() {
			var j Job
			var raw string
			if rows.Scan(&j.ID, &j.Status, &j.CreatedAt, &j.UpdatedAt, &j.Error, &raw) == nil {
				var settings CreateJob
				if json.Unmarshal([]byte(raw), &settings) == nil {
					j.Settings = &settings
				}
				if j.Status == "completed" {
					if info, err := os.Stat(filepath.Join(s.output, j.ID+".wad")); err == nil && info.Mode().IsRegular() {
						j.File = "/api/jobs/" + j.ID + "/download"
					}
				}
				list = append(list, j)
			}
		}
		jsonOut(w, list)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var in CreateJob
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil {
		http.Error(w, "invalid JSON request", 400)
		return
	}
	for key, value := range map[string]string{"game": in.Game, "port": in.Port, "theme": in.Theme, "length": in.Length} {
		definition, ok := findOption(s.options, key)
		if !ok || validateOption(definition, value) != nil {
			http.Error(w, "invalid "+key, 400)
			return
		}
	}
	if len(in.Seed) > 80 || strings.ContainsAny(in.Seed, "\r\n\x00") {
		http.Error(w, "invalid seed", 400)
		return
	}
	if len(in.Options) > 300 {
		http.Error(w, "too many options", 400)
		return
	}
	for key, value := range in.Options {
		definition, ok := findOption(s.options, key)
		if !ok || len(key) > 100 || len(value) > 100 || strings.ContainsAny(key+value, "\r\n\x00") {
			http.Error(w, "invalid option: "+key, 400)
			return
		}
		if validateOption(definition, value) != nil {
			http.Error(w, "invalid value for "+key, 400)
			return
		}
	}
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	now := time.Now().UTC().Format(time.RFC3339)
	body, _ := json.Marshal(in)
	_, e := s.db.Exec(`INSERT INTO jobs(id,status,created_at,updated_at,request_json) VALUES(?,?,?,?,?)`, id, "queued", now, now, string(body))
	if e != nil {
		http.Error(w, "could not create job", 500)
		return
	}
	select {
	case s.queue <- id:
	default:
		_, _ = s.db.Exec(`UPDATE jobs SET status='failed',error='Queue is full' WHERE id=?`, id)
		http.Error(w, "queue is full", 503)
		return
	}
	jsonOut(w, Job{ID: id, Status: "queued", CreatedAt: now, UpdatedAt: now})
}
func (s *Server) job(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/"), "/")
	if len(parts) < 1 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	id := parts[0]
	var j Job
	var raw string
	e := s.db.QueryRow(`SELECT id,status,created_at,updated_at,error,request_json FROM jobs WHERE id=?`, id).Scan(&j.ID, &j.Status, &j.CreatedAt, &j.UpdatedAt, &j.Error, &raw)
	if errors.Is(e, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if e != nil {
		http.Error(w, "database error", 500)
		return
	}
	var settings CreateJob
	if json.Unmarshal([]byte(raw), &settings) == nil {
		j.Settings = &settings
	}
	if len(parts) == 2 && parts[1] == "download" {
		if j.Status != "completed" {
			http.Error(w, "WAD is not ready", 409)
			return
		}
		name := id + ".wad"
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="obsidian-`+id+`.wad"`)
		http.ServeFile(w, r, filepath.Join(s.output, name))
		return
	}
	if len(parts) == 2 && parts[1] == "logs" {
		f, err := os.Open(filepath.Join(s.output, id+".log"))
		if errors.Is(err, os.ErrNotExist) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			return
		}
		if err != nil {
			http.Error(w, "could not read job log", http.StatusInternalServerError)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			http.Error(w, "could not read job log", http.StatusInternalServerError)
			return
		}
		const maxLogBytes = 64 * 1024
		if info.Size() > maxLogBytes {
			if _, err = f.Seek(info.Size()-maxLogBytes, io.SeekStart); err != nil {
				http.Error(w, "could not read job log", http.StatusInternalServerError)
				return
			}
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.Copy(w, f)
		return
	}
	if len(parts) != 1 {
		http.NotFound(w, r)
		return
	}
	if j.Status == "completed" {
		j.File = "/api/jobs/" + id + "/download"
	}
	jsonOut(w, j)
}
func (s *Server) worker() {
	for id := range s.queue {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
		now := time.Now().UTC().Format(time.RFC3339)
		_, _ = s.db.Exec(`UPDATE jobs SET status='running',updated_at=? WHERE id=?`, now, id)
		target := filepath.Join(s.output, id+".wad")
		var raw string
		_ = s.db.QueryRow(`SELECT request_json FROM jobs WHERE id=?`, id).Scan(&raw)
		var in CreateJob
		_ = json.Unmarshal([]byte(raw), &in)
		logPath := filepath.Join(s.output, id+".log")
		logFile, logErr := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if logErr != nil {
			cancel()
			now = time.Now().UTC().Format(time.RFC3339)
			_, _ = s.db.Exec(`UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?`, "Could not create job log: "+logErr.Error(), now, id)
			continue
		}
		args := []string{"--home", env("OBSIDIAN_HOME_DIR", "/home/obsidian"), "--verbose", "--batch", target, "game=" + in.Game, "port=" + in.Port, "theme=" + in.Theme, "length=" + in.Length}
		keys := make([]string, 0, len(in.Options))
		for key := range in.Options {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			args = append(args, key+"="+in.Options[key])
		}
		if _, err := os.Stat("/config/CONFIG.txt"); err == nil {
			args = append(args, "--config", "/config/CONFIG.txt")
		}
		if _, err := os.Stat("/config/OPTIONS.txt"); err == nil {
			args = append(args, "--options", "/config/OPTIONS.txt")
		}
		if in.Seed != "" {
			args = append(args, "seed="+in.Seed)
		}
		cmd := exec.CommandContext(ctx, s.obsidian, args...)
		cmd.Dir = env("OBSIDIAN_HOME", "/opt/obsidian")
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		e := cmd.Run()
		cancel()
		_ = logFile.Sync()
		_ = logFile.Close()
		status, msg := "completed", ""
		if e == nil {
			if _, statErr := os.Stat(target); statErr != nil {
				zipPath := strings.TrimSuffix(target, filepath.Ext(target)) + ".zip"
				if extractErr := extractWADFromZip(zipPath, target); extractErr != nil {
					e = fmt.Errorf("Obsidian completed without creating the WAD: %w (ZIP extraction: %v)", statErr, extractErr)
				} else {
					_ = os.Remove(zipPath)
				}
			}
		}
		if e != nil {
			status = "failed"
			msg = readLogTail(logPath, 4000)
			if len(msg) > 4000 {
				msg = msg[len(msg)-4000:]
			}
			if msg == "" {
				msg = e.Error()
			}
			_ = os.Remove(target)
		}
		now = time.Now().UTC().Format(time.RFC3339)
		_, _ = s.db.Exec(`UPDATE jobs SET status=?,error=?,updated_at=? WHERE id=?`, status, msg, now, id)
	}
}

func extractWADFromZip(zipPath, target string) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, file := range archive.File {
		if file.FileInfo().IsDir() || !strings.EqualFold(filepath.Ext(file.Name), ".wad") {
			continue
		}
		input, err := file.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err != nil {
			_ = input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		inputErr := input.Close()
		outputErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if inputErr != nil {
			return inputErr
		}
		return outputErr
	}
	return errors.New("ZIP contains no WAD file")
}

func recoverBundledWADs(db *sql.DB, output string) error {
	rows, err := db.Query(`SELECT id FROM jobs WHERE status='failed'`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if !strings.Contains(readLogTail(filepath.Join(output, id+".log"), 4096), "Success") {
			continue
		}
		target := filepath.Join(output, id+".wad")
		if _, err := os.Stat(target); err != nil {
			zipPath := filepath.Join(output, id+".zip")
			if err := extractWADFromZip(zipPath, target); err != nil {
				continue
			}
			_ = os.Remove(zipPath)
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if _, err := db.Exec(`UPDATE jobs SET status='completed',error='',updated_at=? WHERE id=? AND status='failed'`, now, id); err != nil {
			return err
		}
	}
	return nil
}

func readLogTail(path string, maxBytes int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return ""
	}
	if info.Size() > maxBytes {
		if _, err = f.Seek(info.Size()-maxBytes, io.SeekStart); err != nil {
			return ""
		}
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return ""
	}
	return string(data)
}
func (s *Server) optionReference(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	jsonOut(w, s.options)
}
func (s *Server) readOptions() (map[string]map[string]map[string]json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.obsidian, "--home", env("OBSIDIAN_HOME_DIR", "/home/obsidian"), "--printref-json")
	cmd.Dir = env("OBSIDIAN_HOME", "/opt/obsidian")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("run --printref-json: %w", err)
	}
	start, end := strings.IndexByte(string(output), '{'), strings.LastIndexByte(string(output), '}')
	if start < 0 || end < start {
		return nil, errors.New("Obsidian returned no JSON option reference")
	}
	var refs map[string]map[string]map[string]json.RawMessage
	if err = json.Unmarshal(output[start:end+1], &refs); err != nil {
		return nil, fmt.Errorf("parse option reference: %w", err)
	}
	if len(refs) == 0 {
		return nil, errors.New("Obsidian returned an empty option reference")
	}
	return refs, nil
}
func findOption(refs map[string]map[string]map[string]json.RawMessage, key string) (map[string]json.RawMessage, bool) {
	for _, group := range refs {
		if option, ok := group[key]; ok {
			return option, true
		}
	}
	return nil, false
}
func validateOption(def map[string]json.RawMessage, value string) error {
	var values []string
	if raw, ok := def["values"]; ok {
		err := json.Unmarshal(raw, &values)
		if err != nil {
			var slider struct {
				Min float64  `json:"min"`
				Max float64  `json:"max"`
				Nan []string `json:"nan"`
			}
			if json.Unmarshal(raw, &slider) == nil && slider.Max >= slider.Min {
				if oneOf(value, slider.Nan...) {
					return nil
				}
				n, parseErr := strconv.ParseFloat(value, 64)
				if parseErr != nil || n < slider.Min || n > slider.Max {
					return errors.New("outside slider range")
				}
				return nil
			}
		}
		if len(values) > 0 {
			if !oneOf(value, values...) {
				return errors.New("not in option values")
			}
			return nil
		}
	}
	if len(values) == 0 {
		_ = json.Unmarshal(def["choices"], &values)
	}
	if len(values) > 0 {
		if !oneOf(value, values...) {
			return errors.New("not in option values")
		}
		return nil
	}
	var nan []string
	if raw, ok := def["nan"]; ok {
		_ = json.Unmarshal(raw, &nan)
		if oneOf(value, nan...) {
			return nil
		}
	}
	var min, max float64
	minRaw, minOK := def["min"]
	maxRaw, maxOK := def["max"]
	if minOK && maxOK {
		if json.Unmarshal(minRaw, &min) != nil || json.Unmarshal(maxRaw, &max) != nil {
			return errors.New("invalid slider metadata")
		}
		n, e := strconv.ParseFloat(value, 64)
		if e != nil || n < min || n > max {
			return errors.New("outside slider range")
		}
	}
	return nil
}
func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func oneOf(v string, allowed ...string) bool {
	for _, x := range allowed {
		if v == x {
			return true
		}
	}
	return false
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func migrate(db *sql.DB) error {
	entries, err := assets.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		var version int
		if _, err = fmt.Sscanf(entry.Name(), "%d_", &version); err != nil {
			return fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		var applied int
		var trackingTable int
		if err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&trackingTable); err != nil {
			return err
		}
		if trackingTable != 0 {
			if err = db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=?`, version).Scan(&applied); err != nil {
				return err
			}
		}
		if applied > 0 {
			continue
		}
		body, e := assets.ReadFile("migrations/" + entry.Name())
		if e != nil {
			return e
		}
		tx, e := db.Begin()
		if e != nil {
			return e
		}
		if _, e = tx.Exec(string(body)); e == nil {
			_, e = tx.Exec(`INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)`, version, time.Now().UTC().Format(time.RFC3339))
		}
		if e != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %s: %w", entry.Name(), e)
		}
		if e = tx.Commit(); e != nil {
			return e
		}
	}
	return nil
}
