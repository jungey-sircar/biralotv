package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"biralotv/backend/internal/models"
	"biralotv/backend/internal/scraper"
	"biralotv/backend/internal/store"
)

type Server struct {
	Store   *store.Store
	Scraper *scraper.Scraper
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("GET /api/v1/sources", s.handleSources)
	mux.HandleFunc("GET /api/v1/groups", s.handleGroups)
	mux.HandleFunc("GET /api/v1/channels", s.handleChannels)
	mux.HandleFunc("GET /api/v1/channels/{id}", s.handleChannel)
	mux.HandleFunc("POST /api/v1/scrape", s.handleScrape)
	mux.HandleFunc("GET /api/v1/scrape/status", s.handleScrapeStatus)

	mux.HandleFunc("POST /api/v1/playlists", s.handlePlaylistCreate)
	mux.HandleFunc("GET /api/v1/playlists", s.handlePlaylistList)
	mux.HandleFunc("DELETE /api/v1/playlists/{id}", s.handlePlaylistDelete)

	mux.HandleFunc("GET /api/v1/favorites", s.handleFavoritesList)
	mux.HandleFunc("PUT /api/v1/favorites/{id}", s.handleFavoriteAdd)
	mux.HandleFunc("DELETE /api/v1/favorites/{id}", s.handleFavoriteRemove)

	mux.HandleFunc("GET /api/v1/recents", s.handleRecentsList)
	mux.HandleFunc("PUT /api/v1/recents/{id}", s.handleRecentAdd)

	mux.HandleFunc("GET /api/v1/m3u", s.handleM3UExport)
	return cors(mux)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	counts, _ := s.Store.CountBySource()
	st := s.Scraper.Status()
	total := int64(0)
	for _, n := range counts {
		total += n
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "channels": total, "sources": counts, "scrape": st})
}

func (s *Server) handleSources(w http.ResponseWriter, _ *http.Request) {
	counts, err := s.Store.CountBySource()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type src struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Kind    string `json:"kind"`
		Count   int64  `json:"channels"`
		Price   string `json:"tier"`
	}
	out := []src{}
	if n, ok := counts[scraper.SourcePremium]; ok {
		out = append(out, src{ID: scraper.SourcePremium, Name: "Mapple Premium", Kind: "live", Count: n, Price: "premium"})
	}
	if n, ok := counts[scraper.SourceSports]; ok {
		out = append(out, src{ID: scraper.SourceSports, Name: "Mapple Sports", Kind: "live", Count: n, Price: "premium"})
	}
	playlists, _ := s.Store.ListPlaylists()
	for _, pl := range playlists {
		id := "user:" + strings.ToLower(pl.Name)
		out = append(out, src{ID: id, Name: pl.Name, Kind: "live", Count: counts[id], Price: "user"})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	src := r.URL.Query().Get("source")
	search, _ := s.Store.DistinctGroups(src)
	writeJSON(w, http.StatusOK, search)
}

func (s *Server) queryFrom(r *http.Request) store.ChannelsQuery {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	perPage, _ := strconv.Atoi(q.Get("per_page"))
	return store.ChannelsQuery{
		Source:    q.Get("source"),
		Group:     q.Get("group"),
		Search:    q.Get("q"),
		Favorites: q.Get("favorites") == "1" || q.Get("favorites") == "true",
		Page:      page,
		PerPage:   perPage,
	}
}

func rowToChannel(r store.ChannelRow) models.Channel {
	return models.Channel{
		ID:      r.ID,
		Name:    r.Name,
		Logo:    r.Logo,
		Stream:  r.Stream,
		Source:  r.Source,
		Group:   r.Gr,
		Number:  r.Number,
		Updated: r.UpdatedAt.UTC(),
	}
}

func (s *Server) handleChannels(w http.ResponseWriter, r *http.Request) {
	q := s.queryFrom(r)
	var favIDs map[string]bool
	if q.Favorites {
		var err error
		favIDs, err = s.Store.ListFavoritesIDs()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	rows, total, err := s.Store.QueryChannels(q, favIDs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	chs := make([]models.Channel, 0, len(rows))
	for _, row := range rows {
		chs = append(chs, rowToChannel(row))
	}
	perPage := q.PerPage
	if perPage <= 0 {
		perPage = 60
	}
	if perPage > 500 {
		perPage = 500
	}
	if q.Page < 1 {
		q.Page = 1
	}
	tp := 0
	if perPage > 0 {
		tp = (total + perPage - 1) / perPage
	}
	writeJSON(w, http.StatusOK, models.Page{
		Channels: chs, Page: q.Page, PerPage: perPage, Total: total, TotalPages: tp,
	})
}

func (s *Server) handleChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	row, err := s.Store.GetChannel(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "channel not found")
		return
	}
	writeJSON(w, http.StatusOK, rowToChannel(row))
}

// ---- scraping ----

func (s *Server) handleScrape(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source string `json:"source"`
		Force  bool   `json:"force"`
	}
	body.Source = scraper.SourceAll
	if r.Body != nil {
		_ = json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body)
	}
	switch strings.ToLower(body.Source) {
	case "", "all":
		body.Source = scraper.SourceAll
	case scraper.SourcePremium, scraper.SourceSports, scraper.SourceAll:
	default:
		writeErr(w, http.StatusBadRequest, "unknown source")
		return
	}
	go func() {
		_ = s.Scraper.Scrape(body.Source, body.Force)
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"started": body.Source, "force": body.Force})
}

func (s *Server) handleScrapeStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Scraper.Status())
}

// ---- playlists (user uploads) ----

func (s *Server) handlePlaylistCreate(w http.ResponseWriter, r *http.Request) {
	ct := r.Header.Get("Content-Type")
	name := ""
	var entries []scraper.M3UEntry
	var fetchedURL string

	if strings.HasPrefix(ct, "multipart/form-data") {
		name = r.FormValue("name")
		if name == "" {
			writeErr(w, http.StatusBadRequest, "name required")
			return
		}
		file, _, err := r.FormFile("file")
		if err == nil {
			data, err := io.ReadAll(io.LimitReader(file, 64<<20))
			file.Close()
			if err != nil {
				writeErr(w, http.StatusBadRequest, "read upload failed")
				return
			}
			entries = scraper.ParseM3U(string(data))
		} else if u := r.FormValue("url"); u != "" {
			text, err := fetchPlaylistText(r, s, u)
			if err != nil {
				writeErr(w, http.StatusBadGateway, "fetch playlist: "+err.Error())
				return
			}
			fetchedURL = u
			entries = scraper.ParseM3U(text)
		} else {
			writeErr(w, http.StatusBadRequest, "file or url required")
			return
		}
	} else {
		var body struct {
			Name string `json:"name"`
			URL  string `json:"url"`
			Text string `json:"text"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid json body")
			return
		}
		name = body.Name
		if name == "" {
			writeErr(w, http.StatusBadRequest, "name required")
			return
		}
		if body.Text != "" {
			entries = scraper.ParseM3U(body.Text)
		} else if body.URL != "" {
			text, err := fetchPlaylistText(r, s, body.URL)
			if err != nil {
				writeErr(w, http.StatusBadGateway, "fetch playlist: "+err.Error())
				return
			}
			fetchedURL = body.URL
			entries = scraper.ParseM3U(text)
		} else {
			writeErr(w, http.StatusBadRequest, "url or text required")
			return
		}
	}

	if len(entries) == 0 {
		writeErr(w, http.StatusBadRequest, "playlist produced no channels")
		return
	}
	s.Store.DeletePlaylistChannelData(name)
	inserted := 0
	for _, e := range entries {
		if err := e.Validate(); err != nil {
			continue
		}
		if err := s.Store.UpsertChannel(store.ChannelRow{
			ID:     e.IDFor(name),
			Name:   e.Name,
			Logo:   e.Logo,
			Stream: e.URL,
			Source: scraper.UserChannelIDSource(name),
			Gr:     e.Group,
		}); err != nil {
			continue
		}
		inserted++
	}
	pl, err := s.Store.UpsertPlaylist(name, fetchedURL, inserted)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"playlist": pl, "channels": inserted})
}

func (s *Server) handlePlaylistList(w http.ResponseWriter, _ *http.Request) {
	playlists, err := s.Store.ListPlaylists()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	counts, _ := s.Store.CountBySource()
	out := make([]map[string]any, 0, len(playlists))
	for _, pl := range playlists {
		id := "user:" + strings.ToLower(pl.Name)
		out = append(out, map[string]any{
			"id": pl.ID, "name": pl.Name, "url": pl.URL,
			"created_at": pl.CreatedAt.UTC(), "channel_count": counts[id],
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePlaylistDelete(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.Store.DeletePlaylist(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": id})
}

// ---- favorites ----

func (s *Server) handleFavoritesList(w http.ResponseWriter, _ *http.Request) {
	ids, err := s.Store.ListFavoritesIDs()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	chs := make([]models.Channel, 0, len(ids))
	q := store.ChannelsQuery{Favorites: true, PerPage: 500}
	rows, _, err := s.Store.QueryChannels(q, ids)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, row := range rows {
		chs = append(chs, rowToChannel(row))
	}
	writeJSON(w, http.StatusOK, chs)
}

func (s *Server) handleFavoriteAdd(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetChannel(id); err != nil {
		writeErr(w, http.StatusNotFound, "channel not found")
		return
	}
	if err := s.Store.AddFavorite(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFavoriteRemove(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.RemoveFavorite(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- recents ----

func (s *Server) recentIDs() []string {
	var ids []string
	_ = s.Store.ListRecentIDs(&ids)
	return ids
}

func (s *Server) handleRecentsList(w http.ResponseWriter, _ *http.Request) {
	ids := s.recentIDs()
	rows := make([]models.Channel, 0, len(ids))
	for _, id := range ids {
		row, err := s.Store.GetChannel(id)
		if err != nil {
			continue
		}
		rows = append(rows, rowToChannel(row))
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleRecentAdd(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetChannel(id); err != nil {
		writeErr(w, http.StatusNotFound, "channel not found")
		return
	}
	if err := s.Store.AddRecent(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- m3u export ----

func (s *Server) handleM3UExport(w http.ResponseWriter, r *http.Request) {
	src := r.URL.Query().Get("source")
	q := store.ChannelsQuery{Source: src, PerPage: 5000, Page: 1}
	totalExported := 0
	w.Header().Set("Content-Type", "audio/x-mpegurl; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="biralotv.m3u"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("#EXTM3U\n"))
	for {
		rows, total, err := s.Store.QueryChannels(q, nil)
		if err != nil {
			return
		}
		for _, row := range rows {
			line := fmt.Sprintf(`#EXTINF:-1 tvg-logo="%s" group-title="%s",%s`, row.Logo, row.Gr, row.Name)
			_, _ = w.Write([]byte(line + "\n" + row.Stream + "\n"))
			totalExported++
		}
		if len(rows) == 0 || len(rows) >= total {
			break
		}
		q.Page++
		if q.Page > 100 {
			break
		}
	}
}

// helpers

func fetchPlaylistText(r *http.Request, s *Server, url string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "biralotv-scraper/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

