package main

// Upstream transport.
//
// Provider metadata and provider media use different clients. The media client
// leaves compression alone because the stream proxy forwards byte ranges and
// content lengths.

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"
)

const browserUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"

func newTransport(compression bool) *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	dialNet := "tcp4"
	if runtime.GOOS == "android" {
		// Mobile networks can rely on NAT64 / dual-stack routing; let Android pick.
		dialNet = "tcp"
	}
	return &http.Transport{
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   64,
		MaxConnsPerHost:       128,
		DisableCompression:    !compression,
		ResponseHeaderTimeout: 20 * time.Second,
		IdleConnTimeout:       5 * time.Minute,
		Proxy:                 upstreamProxy(),
		TLSClientConfig:       platformTLSConfig(),
		// Several media providers treat datacenter IPv6 as hostile. Keep
		// upstream traffic on IPv4 on servers/desktops for predictable results.
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, dialNet, addr)
		},
	}
}

// upstreamProxy sends selected provider hosts through SCRAPER_UPSTREAM_PROXY.
// Some providers block datacenter ranges, so this is the escape hatch when the
// scraper runs on a VPS.
//
// SCRAPER_UPSTREAM_PROXY_HOSTS is a comma separated list of host suffixes.
// Only those hosts use the proxy; media segments and everything else stay
// direct. Unset with a proxy configured sends every request through it.
func upstreamProxy() func(*http.Request) (*url.URL, error) {
	raw := strings.TrimSpace(os.Getenv("SCRAPER_UPSTREAM_PROXY"))
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil
	}
	via := http.ProxyURL(u)

	hosts := proxyHosts()
	if len(hosts) == 0 {
		return via
	}
	return func(r *http.Request) (*url.URL, error) {
		h := strings.ToLower(r.URL.Hostname())
		for _, suffix := range hosts {
			if h == suffix || strings.HasSuffix(h, "."+suffix) {
				return via(r)
			}
		}
		return nil, nil
	}
}

func proxyHosts() []string {
	raw := strings.TrimSpace(os.Getenv("SCRAPER_UPSTREAM_PROXY_HOSTS"))
	if raw == "" {
		return nil
	}
	var out []string
	for _, item := range strings.Split(raw, ",") {
		item = strings.ToLower(strings.TrimSpace(item))
		item = strings.TrimPrefix(item, ".")
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

// upstreamClient keeps bytes exactly as they arrive.
var upstreamClient = &http.Client{Transport: newTransport(false)}

// textClient is for JSON and playlists where compression is free speed.
var textClient = &http.Client{Transport: newTransport(true)}

func upstreamRequest(ctx context.Context, method, rawURL string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", "https://www.vidy.st/")
	req.Header.Set("Origin", "https://www.vidy.st")
	return req, nil
}

func fetchText(ctx context.Context, rawURL string) (string, error) {
	req, err := upstreamRequest(ctx, "GET", rawURL)
	if err != nil {
		return "", err
	}
	resp, err := textClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", &upstreamStatus{resp.StatusCode}
	}
	return string(body), nil
}

type upstreamStatus struct{ code int }

func (e *upstreamStatus) Error() string { return "upstream returned HTTP " + http.StatusText(e.code) }

func fetchObject(ctx context.Context, rawURL string) (map[string]interface{}, error) {
	raw, err := fetchText(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}
