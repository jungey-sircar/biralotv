package main

// Movie catalog proxy backed by the metadata host (metaBase).
// Keeps the same HTTP client, timeouts, and optional SCRAPER_UPSTREAM_PROXY rules
// as stream resolution while providing a key-free catalog feed to clients.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var catalogBaseURL = metaBase

func catalogQuery(list string, query url.Values, page int) (string, bool) {
	q := url.Values{}
	q.Set("language", "en-US")
	q.Set("page", strconv.Itoa(page))

	if qText := strings.TrimSpace(query.Get("q")); qText != "" {
		q.Set("query", qText)
		q.Set("include_adult", "false")
		return "/search/movie?" + q.Encode(), true
	}

	switch strings.ToLower(strings.TrimSpace(list)) {
	case "", "latest", "now_playing":
		return "/movie/now_playing?" + q.Encode(), true
	case "trending":
		return "/trending/movie/week?" + q.Encode(), true
	case "popular":
		return "/movie/popular?" + q.Encode(), true
	case "top_rated":
		return "/movie/top_rated?" + q.Encode(), true
	case "upcoming":
		return "/movie/upcoming?" + q.Encode(), true
	default:
		return "", false
	}
}

func handleCatalogMovies(w http.ResponseWriter, r *http.Request) {
	page := 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		n, err := strconv.Atoi(rawPage)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_page", "Page must be a positive integer.")
			return
		}
		page = n
	}

	rel, ok := catalogQuery(r.URL.Query().Get("list"), r.URL.Query(), page)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_list", "Use latest, now_playing, trending, popular, top_rated or upcoming.")
		return
	}

	proxyCatalogJSON(w, r, rel)
}

func handleCatalogMovieDetail(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTMDB(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_tmdb_id", "The TMDB id must be a positive integer.")
		return
	}
	rel := "/movie/" + strconv.Itoa(id) + "?language=en-US&append_to_response=videos"
	proxyCatalogJSON(w, r, rel)
}

func proxyCatalogJSON(w http.ResponseWriter, r *http.Request, rel string) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	raw, err := fetchText(ctx, strings.TrimRight(catalogBaseURL, "/")+rel)
	if err != nil {
		var upstream *upstreamStatus
		if errors.As(err, &upstream) && upstream.code == http.StatusNotFound {
			writeError(w, http.StatusNotFound, "not_found", "The requested catalog entry was not found.")
			return
		}
		writeResolveError(w, "catalog", rel, err)
		return
	}
	if !json.Valid([]byte(raw)) {
		writeError(w, http.StatusBadGateway, "upstream_error", "The catalog provider returned invalid JSON.")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(raw))
}

