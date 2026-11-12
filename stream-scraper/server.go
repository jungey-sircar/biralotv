package main

// HTTP surface. No auth, no handshake, no cookies. Three source aliases map to
// the three scrapers and every response is plain JSON.

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const apiVersion = "1.0.0"

var startedAt = time.Now()

type sourceDef struct {
	alias  string
	number int
}

func parseSource(raw string) (sourceDef, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "server1", "1":
		return sourceDef{alias: "server1", number: 1}, true
	case "server2", "2":
		return sourceDef{alias: "server2", number: 2}, true
	case "server3", "3":
		return sourceDef{alias: "server3", number: 3}, true
	}
	return sourceDef{}, false
}

func parseTMDB(raw string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func parseIndex(raw string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "ok",
		"uptime_s": int(time.Since(startedAt).Seconds()),
		"version":  apiVersion,
	})
}

func handleServers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"servers": []map[string]string{
			{"id": "server1", "note": "Default. Optional mirror query parameter."},
			{"id": "server2", "note": "Primary catalog first, secondary catalog fallback."},
			{"id": "server3", "note": "Secondary catalog only. No fallback."},
		},
	})
}

func handleMovie(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTMDB(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_tmdb_id", "The TMDB id must be a positive integer.")
		return
	}
	source, ok := parseSource(r.URL.Query().Get("server"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_server", "Use server1, server2 or server3.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	base := baseOf(r)
	var media *resolvedMedia
	var err error
	switch source.number {
	case 2:
		media, err = buildSource2Payload(ctx, base, "movie", strconv.Itoa(id), 0, 0)
	case 3:
		media, err = buildSource3Payload(ctx, base, "movie", strconv.Itoa(id), 0, 0)
	default:
		media, err = resolveSource1(ctx, base, "movie", strconv.Itoa(id), 0, 0, r.URL.Query().Get("mirror"))
	}
	if err != nil {
		writeResolveError(w, "movie/"+source.alias, strconv.Itoa(id), err)
		return
	}
	writeJSON(w, http.StatusOK, responseFor(media, id, source))
}

func handleEpisode(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTMDB(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_tmdb_id", "The TMDB id must be a positive integer.")
		return
	}
	season, sOK := parseIndex(r.PathValue("season"))
	episode, eOK := parseIndex(r.PathValue("episode"))
	if !sOK || !eOK || season == 0 {
		writeError(w, http.StatusBadRequest, "invalid_episode", "Season must be at least 1 and episode must be at least 0.")
		return
	}
	source, ok := parseSource(r.URL.Query().Get("server"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_server", "Use server1, server2 or server3.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	base := baseOf(r)
	var media *resolvedMedia
	var err error
	switch source.number {
	case 2:
		media, err = buildSource2Payload(ctx, base, "tv", strconv.Itoa(id), season, episode)
	case 3:
		media, err = buildSource3Payload(ctx, base, "tv", strconv.Itoa(id), season, episode)
	default:
		media, err = resolveSource1(ctx, base, "tv", strconv.Itoa(id), season, episode, r.URL.Query().Get("mirror"))
	}
	if err != nil {
		writeResolveError(w, "episode/"+source.alias, strconv.Itoa(id), err)
		return
	}
	writeJSON(w, http.StatusOK, responseFor(media, id, source))
}

func responseFor(media *resolvedMedia, id int, source sourceDef) streamResponse {
	out := streamResponse{
		Type:       media.Type,
		TMDBID:     id,
		Season:     media.Season,
		Episode:    media.Episode,
		Server:     source.alias,
		ResolvedBy: media.ResolvedBy,
		Playlist:   media.Playlist,
		Streams:    media.Streams,
		Thumbnails: media.Thumbnails,
		Subtitles:  media.Subtitles,
	}
	if out.Streams == nil {
		out.Streams = []streamVariant{}
	}
	if out.Subtitles == nil {
		out.Subtitles = []subtitleTrack{}
	}
	return out
}

func writeResolveError(w http.ResponseWriter, scope, id string, err error) {
	logUpstream(scope, id, err)

	var upstream *upstreamStatus
	switch {
	case errors.Is(err, errNoStreams),
		errors.Is(err, errSource2NoSource),
		errors.Is(err, errSource3NoSource):
		writeError(w, http.StatusNotFound, "no_streams", "No stream was found for this title on the requested server.")
	case errors.Is(err, context.DeadlineExceeded), os.IsTimeout(err):
		writeError(w, http.StatusGatewayTimeout, "upstream_timeout", "The upstream provider took too long to answer.")
	case errors.As(err, &upstream):
		writeError(w, http.StatusBadGateway, "upstream_error", "The upstream provider returned an error.")
	default:
		writeError(w, http.StatusBadGateway, "upstream_error", "The upstream provider did not answer correctly.")
	}
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]interface{}{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func logUpstream(scope, id string, err error) {
	log.Printf("upstream %s %s: %v", scope, id, err)
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.wrote = true
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %dB %s", r.Method, r.URL.RequestURI(), sw.status, sw.bytes, time.Since(start).Round(time.Millisecond))
	})
}

func recoverMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic: %v", v)
				writeError(w, http.StatusInternalServerError, "internal_error", "The scraper hit an unexpected error.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func corsMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)
	mux.HandleFunc("GET /v1/servers", handleServers)
	mux.HandleFunc("GET /v1/catalog/movies", handleCatalogMovies)
	mux.HandleFunc("GET /v1/catalog/movies/{id}", handleCatalogMovieDetail)
	mux.HandleFunc("GET /v1/movies/{id}", handleMovie)
	mux.HandleFunc("GET /v1/shows/{id}/seasons/{season}/episodes/{episode}", handleEpisode)
	mux.HandleFunc("GET /v1/subtitles/movies/{id}", handleMovieSubtitles)
	mux.HandleFunc("GET /v1/subtitles/shows/{id}/seasons/{season}/episodes/{episode}", handleEpisodeSubtitles)
	mux.HandleFunc("GET /v1/subtitle/{id}", handleSubtitleProxy)
	mux.HandleFunc("GET /v1/stream/{token}", handleStreamProxy)
	return recoverMW(logMW(corsMW(mux)))
}
