package scraper

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const listingFlightURL = "https://mapple.fun/live-tv-premium"

type HTTP struct {
	Client *http.Client
	UA     string
}

func NewHTTP(timeout time.Duration, concurrency int) *HTTP {
	t := &http.Transport{
		MaxIdleConns:        concurrency * 2,
		MaxIdleConnsPerHost: concurrency,
		MaxConnsPerHost:     0,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  false,
	}
	return &HTTP{
		Client: &http.Client{Timeout: timeout, Transport: t},
		UA:     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	}
}

func (h *HTTP) Get(url string, headers map[string]string) (string, int, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", h.UA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := h.Client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 12<<20))
	return string(body), resp.StatusCode, err
}

// Post sends a POST with a raw body (used for Next.js server actions).
func (h *HTTP) Post(url string, headers map[string]string, contentType, body string) (string, int, error) {
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", h.UA)
	req.Header.Set("Origin", "https://mapple.fun")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := h.Client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 12<<20))
	return string(data), resp.StatusCode, err
}

// GetWithRetry retries transient failures.
func (h *HTTP) GetWithRetry(url string, headers map[string]string, attempts int) (string, error) {
	var lastErr error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			time.Sleep(time.Duration(200*(1<<i)) * time.Millisecond)
		}
		body, code, err := h.Get(url, headers)
		if code < 500 && code != 429 && err == nil {
			if code >= 400 {
				return "", fmt.Errorf("unexpected status %d for %s", code, url)
			}
			return body, nil
		}
		lastErr = fmt.Errorf("transient status=%d err=%v url=%s", code, err, url)
	}
	return "", lastErr
}

// ---- listing flight parsing ----

type ListingChannel struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Logo  string `json:"logo"`
	Href  string `json:"href"`
}

var channelsKey = []byte(`"channels":[`)

// ParseFlightChannels extracts the "channels":[...] array from a Next.js flight payload.
func ParseFlightChannels(flight string) ([]ListingChannel, error) {
	idx := strings.Index(flight, `"channels":[{`)
	if idx < 0 {
		return nil, fmt.Errorf("channels array not found in flight payload")
	}
	start := idx + len(`"channels":[`)
	// JSON-array scan: find balanced end of array
	end, err := scanJSONArray(flight, start-1)
	if err != nil {
		return nil, err
	}
	arr := flight[start-1 : end+1]
	var chs []ListingChannel
	if err := json.Unmarshal([]byte(arr), &chs); err != nil {
		return nil, fmt.Errorf("decode channels: %w", err)
	}
	return chs, nil
}

// scanJSONArray returns index of closing bracket of array whose opening bracket is at openIdx.
func scanJSONArray(s string, openIdx int) (int, error) {
	depth := 0
	inStr := false
	esc := false
	for i := openIdx; i < len(s); i++ {
		c := s[i]
		if inStr {
			if esc {
				esc = false
			} else if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '[', '{':
			depth++
		case ']', '}':
			depth--
			if depth == 0 {
				return i, nil
			}
		}
	}
	return 0, fmt.Errorf("unbalanced array")
}

var iframeRe = regexp.MustCompile(`<iframe[^>]+src\s*=\s*"([^"]+)"`)
var m3u8Re = regexp.MustCompile(`https?://[^"'\\\x00-\x20]+\.m3u8[^"'\\\x00-\x20]*`)

func extractIframeSrc(html string) string {
	m := iframeRe.FindStringSubmatch(html)
	if len(m) >= 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func firstM3U8(body string) string {
	u := m3u8Re.FindString(body)
	return strings.TrimSpace(u)
}
