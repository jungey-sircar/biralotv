package main

import (
	"net/http"
	"testing"
)

func proxyFor(t *testing.T, rawURL string) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	fn := upstreamProxy()
	if fn == nil {
		return ""
	}
	u, err := fn(req)
	if err != nil {
		t.Fatal(err)
	}
	if u == nil {
		return ""
	}
	return u.Host
}

func TestUpstreamProxyEnv(t *testing.T) {
	t.Setenv("SCRAPER_UPSTREAM_PROXY", "")
	t.Setenv("SCRAPER_UPSTREAM_PROXY_HOSTS", "")
	if proxyFor(t, "https://catalog.example/") != "" {
		t.Fatal("empty env must stay direct")
	}

	t.Setenv("SCRAPER_UPSTREAM_PROXY", "socks5://127.0.0.1:1080")
	if got := proxyFor(t, "https://catalog.example/"); got != "127.0.0.1:1080" {
		t.Fatalf("proxy = %q, want 127.0.0.1:1080", got)
	}
}

func TestUpstreamProxyHostScope(t *testing.T) {
	t.Setenv("SCRAPER_UPSTREAM_PROXY", "socks5://127.0.0.1:1080")
	t.Setenv("SCRAPER_UPSTREAM_PROXY_HOSTS", "wecollege.net, catalog.example")

	if got := proxyFor(t, "https://api.wecollege.net/seed?mediaId=1"); got != "127.0.0.1:1080" {
		t.Fatalf("api.wecollege.net proxy = %q, want proxied", got)
	}
	if got := proxyFor(t, "https://catalog.example/tv/x/1/1"); got != "127.0.0.1:1080" {
		t.Fatalf("catalog.example proxy = %q, want proxied", got)
	}
	if got := proxyFor(t, "https://cdn.wecollege.net.invalid/x"); got != "" {
		t.Fatalf("lookalike host proxy = %q, want direct", got)
	}
	if got := proxyFor(t, "https://stream.example-cdn.net/seg1.ts"); got != "" {
		t.Fatalf("segment host proxy = %q, want direct", got)
	}
}
