package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalogMoviesListsAndSearch(t *testing.T) {
	var seenPath, seenQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seenQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"page":1,"results":[{"id":19,"title":"Metropolis"}]}`)
	}))
	defer srv.Close()

	orig := catalogBaseURL
	catalogBaseURL = srv.URL
	t.Cleanup(func() { catalogBaseURL = orig })

	cases := []struct {
		target   string
		wantPath string
		wantQ    string
	}{
		{"/v1/catalog/movies", "/movie/now_playing", "page=1"},
		{"/v1/catalog/movies?list=latest&page=2", "/movie/now_playing", "page=2"},
		{"/v1/catalog/movies?list=trending", "/trending/movie/week", "page=1"},
		{"/v1/catalog/movies?list=popular", "/movie/popular", "page=1"},
		{"/v1/catalog/movies?q=matrix&page=3", "/search/movie", "query=matrix"},
	}

	router := newRouter()
	for _, tc := range cases {
		seenPath, seenQuery = "", ""
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, tc.target, nil)
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d: %s", tc.target, rec.Code, rec.Body.String())
		}
		if seenPath != tc.wantPath {
			t.Fatalf("%s: upstream path = %q, want %q", tc.target, seenPath, tc.wantPath)
		}
		if !strings.Contains(seenQuery, tc.wantQ) {
			t.Fatalf("%s: upstream query = %q, want substring %q", tc.target, seenQuery, tc.wantQ)
		}
		if !strings.Contains(rec.Body.String(), `"Metropolis"`) {
			t.Fatalf("%s: unexpected body = %s", tc.target, rec.Body.String())
		}
	}
}

func TestCatalogMoviesValidationAndErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/movie/19":
			fmt.Fprint(w, `{"id":19,"title":"Metropolis"}`)
		case "/movie/99999999":
			http.NotFound(w, r)
		default:
			fmt.Fprint(w, `not-json`)
		}
	}))
	defer srv.Close()

	orig := catalogBaseURL
	catalogBaseURL = srv.URL
	t.Cleanup(func() { catalogBaseURL = orig })

	router := newRouter()

	for _, bad := range []struct {
		url  string
		code int
		err  string
	}{
		{"/v1/catalog/movies?list=unknown", http.StatusBadRequest, "invalid_list"},
		{"/v1/catalog/movies?page=0", http.StatusBadRequest, "invalid_page"},
		{"/v1/catalog/movies/abc", http.StatusBadRequest, "invalid_tmdb_id"},
		{"/v1/catalog/movies/99999999", http.StatusNotFound, "not_found"},
		{"/v1/catalog/movies?list=popular", http.StatusBadGateway, "upstream_error"},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, bad.url, nil)
		router.ServeHTTP(rec, req)
		if rec.Code != bad.code {
			t.Fatalf("%s: status = %d, want %d (%s)", bad.url, rec.Code, bad.code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), bad.err) {
			t.Fatalf("%s: body = %s, want %q", bad.url, rec.Body.String(), bad.err)
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/catalog/movies/19", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"Metropolis"`) {
		t.Fatalf("/v1/catalog/movies/19 = %d %s", rec.Code, rec.Body.String())
	}
}

