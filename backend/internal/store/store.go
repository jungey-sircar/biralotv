package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	mu sync.Mutex // serialize writes; sqlite single-writer
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(2)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  logo       TEXT,
  stream     TEXT,
  source     TEXT NOT NULL,
  gr         TEXT,
  number     TEXT,
  upper_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_source ON channels(source);
CREATE INDEX IF NOT EXISTS idx_channels_upper ON channels(upper_name);
CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(gr);

CREATE TABLE IF NOT EXISTS playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  url        TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recents (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  watched_at INTEGER NOT NULL
);
`)
	return err
}

func normalizeID(source, sub string) string {
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return -1
	}, source)
	return clean + ":" + sub
}

type ChannelRow struct {
	ID, Name, Logo, Stream, Source, Gr, Number string
	UpdatedAt                                  time.Time
}

func (s *Store) UpsertChannel(r ChannelRow) error {
	if r.ID == "" || r.Name == "" {
		return errors.New("empty id/name")
	}
	if r.ID == "" {
		r.ID = normalizeID(r.Source, r.Name)
	}
	if r.ID == "" {
		r.ID = normalizeID(r.Source, strings.ToLower(strings.ReplaceAll(r.Name, " ", "-")))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO channels (id,name,logo,stream,source,gr,number,upper_name,updated_at)
VALUES (?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, logo=excluded.logo, stream=excluded.stream, gr=excluded.gr, number=excluded.number, upper_name=excluded.upper_name, updated_at=excluded.updated_at`,
		r.ID, r.Name, r.Logo, r.Stream, r.Source, r.Gr, r.Number, strings.ToUpper(strings.TrimSpace(r.Name)), time.Now().Unix())
	return err
}

func (s *Store) ChannelExistsFresh(id string, ttl time.Duration) (bool, error) {
	var ts int64
	err := s.db.QueryRow(`SELECT updated_at FROM channels WHERE id=?`, id).Scan(&ts)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return time.Now().Unix()-ts < int64(ttl.Hours()*3600), nil
}

func (s *Store) DeleteStaleBySource(source string, cutoff int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM channels WHERE source=? AND updated_at < ?`, source, cutoff)
	return err
}

func (s *Store) ClearSource(source string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM channels WHERE source=?`, source)
	return err
}

func (s *Store) CountBySource() (map[string]int64, error) {
	rows, err := s.db.Query(`SELECT source, COUNT(*) FROM channels GROUP BY source`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]int64{}
	for rows.Next() {
		var src string
		var n int64
		if err := rows.Scan(&src, &n); err != nil {
			return nil, err
		}
		m[src] = n
	}
	return m, rows.Err()
}

type ChannelsQuery struct {
	Source    string
	Group     string
	Search    string
	Favorites bool
	Page      int
	PerPage   int
}

func (s *Store) QueryChannels(q ChannelsQuery, favIDs map[string]bool) ([]ChannelRow, int, error) {
	where := []string{"1=1"}
	args := []any{}
	if q.Source != "" {
		if strings.HasPrefix(q.Source, "user:") {
			// match any user playlist under the same name prefix, or exact
			where = append(where, `source=?`)
			args = append(args, q.Source)
		} else {
			where = append(where, `source=?`)
			args = append(args, q.Source)
		}
	}
	if q.Group != "" {
		where = append(where, `gr=?`)
		args = append(args, q.Group)
	}
	if q.Search != "" {
		where = append(where, `upper_name LIKE ?`)
		args = append(args, "%"+strings.ToUpper(strings.TrimSpace(q.Search))+"%")
	}
	clause := strings.Join(where, " AND ")
	var total int
	filt := ""
	if q.Favorites {
		if len(favIDs) == 0 {
			return nil, 0, nil
		}
		ids := []string{}
		for id := range favIDs {
			ids = append(ids, id)
		}
		ph := make([]string, len(ids))
		for i, id := range ids {
			ph[i] = "?"
			args = append(args, id)
		}
		filt = ` AND id IN (` + strings.Join(ph, ",") + `)`
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM channels WHERE `+clause+filt, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return nil, 0, nil
	}
	perPage := q.PerPage
	if perPage <= 0 {
		perPage = 60
	}
	if perPage > 500 {
		perPage = 500
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * perPage
	listArgs := append(append([]any{}, args...), perPage, offset)
	rows, err := s.db.Query(`SELECT id,name,COALESCE(logo,''),COALESCE(stream,''),source,COALESCE(gr,''),COALESCE(number,''),updated_at FROM channels WHERE `+clause+filt+` ORDER BY upper_name ASC LIMIT ? OFFSET ?`,
		listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ChannelRow{}
	for rows.Next() {
		var r ChannelRow
		var ts int64
		if err := rows.Scan(&r.ID, &r.Name, &r.Logo, &r.Stream, &r.Source, &r.Gr, &r.Number, &ts); err != nil {
			return nil, 0, err
		}
		r.UpdatedAt = time.Unix(ts, 0)
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func (s *Store) GetChannel(id string) (ChannelRow, error) {
	var r ChannelRow
	var ts int64
	err := s.db.QueryRow(`SELECT id,name,COALESCE(logo,''),COALESCE(stream,''),source,COALESCE(gr,''),COALESCE(number,''),updated_at FROM channels WHERE id=?`, id).
		Scan(&r.ID, &r.Name, &r.Logo, &r.Stream, &r.Source, &r.Gr, &r.Number, &ts)
	if errors.Is(err, sql.ErrNoRows) {
		return r, errors.New("not found")
	}
	if err == nil {
		r.UpdatedAt = time.Unix(ts, 0)
	}
	return r, err
}

func (s *Store) DistinctGroups(source string) ([]string, error) {
	var rows *sql.Rows
	var err error
	if source == "" {
		rows, err = s.db.Query(`SELECT DISTINCT gr FROM channels WHERE gr<>'' ORDER BY gr`)
	} else {
		rows, err = s.db.Query(`SELECT DISTINCT gr FROM channels WHERE gr<>'' AND source=? ORDER BY gr`, source)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Playlists

type PlaylistRow struct {
	ID       int64
	Name, URL string
	CreatedAt time.Time
	_Channels int
}

func (s *Store) UpsertPlaylist(name, url string, channelCount int) (PlaylistRow, error) {
	_ = channelCount
	ts := time.Now().Unix()
	var id int64
	s.mu.Lock()
	_, err := s.db.Exec(`INSERT INTO playlists (name,url,created_at) VALUES (?,?,?)
ON CONFLICT(name) DO UPDATE SET url=excluded.url`, name, url, ts)
	s.mu.Unlock()
	if err != nil {
		return PlaylistRow{}, err
	}
	row := s.db.QueryRow(`SELECT id FROM playlists WHERE name=?`, name)
	if e := row.Scan(&id); e != nil {
		return PlaylistRow{}, e
	}
	// channel count via query
	_ = channelCount
	return PlaylistRow{ID: id, Name: name, URL: url}, nil
}

func (s *Store) DeletePlaylistChannelData(name string) error {
	return s.ClearSource("user:" + name)
}

func (s *Store) CountUserChannels(name string) (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM channels WHERE source=?`, "user:"+name).Scan(&n)
	return n, err
}

func (s *Store) ListPlaylists() ([]PlaylistRow, error) {
	rows, err := s.db.Query(`SELECT id,name,url,created_at FROM playlists ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PlaylistRow
	for rows.Next() {
		var r PlaylistRow
		var ts int64
		var url sql.NullString
		if err := rows.Scan(&r.ID, &r.Name, &url, &ts); err != nil {
			return nil, err
		}
		r.URL = url.String
		r.CreatedAt = time.Unix(ts, 0)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetPlaylist(id int64) (PlaylistRow, error) {
	var r PlaylistRow
	var ts int64
	var url sql.NullString
	err := s.db.QueryRow(`SELECT id,name,url,created_at FROM playlists WHERE id=?`, id).Scan(&r.ID, &r.Name, &url, &ts)
	if errors.Is(err, sql.ErrNoRows) {
		return r, os.ErrNotExist
	}
	if err == nil {
		r.URL = url.String
		r.CreatedAt = time.Unix(ts, 0)
	}
	return r, err
}

func (s *Store) GetPlaylistByName(name string) (PlaylistRow, error) {
	var r PlaylistRow
	var ts int64
	var url sql.NullString
	err := s.db.QueryRow(`SELECT id,name,url,created_at FROM playlists WHERE name=?`, name).Scan(&r.ID, &r.Name, &url, &ts)
	if errors.Is(err, sql.ErrNoRows) {
		return r, os.ErrNotExist
	}
	if err == nil {
		r.URL = url.String
		r.CreatedAt = time.Unix(ts, 0)
	}
	return r, err
}

func (s *Store) DeletePlaylist(id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	var name string
	if err := tx.QueryRow(`SELECT name FROM playlists WHERE id=?`, id).Scan(&name); err != nil {
		tx.Rollback()
		return err
	}
	_, err = tx.Exec(`DELETE FROM channels WHERE source=?`, "user:"+name)
	if err == nil {
		_, err = tx.Exec(`DELETE FROM playlists WHERE id=?`, id)
	}
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Favorites

func (s *Store) AddFavorite(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO favorites (channel_id,created_at) VALUES (?,?) ON CONFLICT(channel_id) DO NOTHING`, id, time.Now().Unix())
	return err
}

func (s *Store) RemoveFavorite(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM favorites WHERE channel_id=?`, id)
	return err
}

func (s *Store) ListFavoritesIDs() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT channel_id FROM favorites`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		m[id] = true
	}
	return m, rows.Err()
}

// Recents

func (s *Store) AddRecent(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO recents (channel_id,watched_at) VALUES (?,?)
ON CONFLICT(channel_id) DO UPDATE SET watched_at=excluded.watched_at`, id, time.Now().Unix())
	return err
}

func (s *Store) ListRecentIDs(ids *[]string) error {
	rows, err := s.db.Query(`SELECT channel_id FROM recents ORDER BY watched_at DESC LIMIT 50`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		out = append(out, id)
	}
	*ids = out
	return rows.Err()
}
