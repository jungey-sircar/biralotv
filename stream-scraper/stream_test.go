package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func resetStreams() {
	streams = &tokenStore{entries: map[string]streamEntry{}}
}

func TestProxyTokenIsStableAcrossRotatingQuery(t *testing.T) {
	resetStreams()
	first := proxyURL("http://example.test", "https://cdn.example.test/movie/seg-1.ts?token=one")
	second := proxyURL("http://example.test", "https://cdn.example.test/movie/seg-1.ts?token=two")
	if first != second {
		t.Fatalf("token changed with query rotation:\n%s\n%s", first, second)
	}
	if !strings.HasPrefix(first, "http://example.test/v1/stream/") {
		t.Fatalf("unexpected proxy URL: %s", first)
	}
	token := strings.TrimPrefix(first, "http://example.test/v1/stream/")
	entry, ok := streams.get(token)
	if !ok || entry.url != "https://cdn.example.test/movie/seg-1.ts?token=two" {
		t.Fatalf("store did not keep the latest upstream URL: %+v", entry)
	}
}

func TestStreamProxyRewritesPlaylist(t *testing.T) {
	resetStreams()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/master.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			fmt.Fprint(w, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nseg.ts\n")
		case "/seg.ts":
			w.Header().Set("Content-Type", "video/mp2t")
			w.Write([]byte("segment-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	token := strings.TrimPrefix(proxyURL("http://proxy.test", upstream.URL+"/master.m3u8"), "http://proxy.test/v1/stream/")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/stream/"+token, nil)
	req.Host = "proxy.test"
	newRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("playlist status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "http://proxy.test/v1/stream/") {
		t.Fatalf("playlist not rewritten: %s", body)
	}

	lines := strings.Split(body, "\n")
	var segment string
	for _, line := range lines {
		if strings.HasPrefix(line, "http://") {
			segment = line
		}
	}
	if segment == "" {
		t.Fatalf("no segment URL in playlist: %s", body)
	}
	u, err := url.Parse(segment)
	if err != nil {
		t.Fatal(err)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, u.RequestURI(), nil)
	req.Host = "proxy.test"
	newRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "segment-bytes" {
		t.Fatalf("segment = %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/mp2t" {
		t.Fatalf("segment content-type = %q", ct)
	}
}

func TestStreamProxyMissingToken(t *testing.T) {
	resetStreams()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/stream/doesnotexist", nil)
	newRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "stream_not_found") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}
