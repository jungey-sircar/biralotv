package main

// Playback stream store and proxy.
//
// Providers hand back URLs that often carry short lived query tokens and need
// specific referer headers. The store keeps those URLs server side and exposes
// stable /v1/stream/{token} links. HLS playlists are rewritten recursively so
// variants, keys, init maps and segments all stay behind the proxy.

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	streamTTL    = 4 * time.Hour
	maxStreamURL = 50000
)

type streamEntry struct {
	url       string
	at        time.Time
	subtitles []subtitleTrack
}

type tokenStore struct {
	mu      sync.RWMutex
	entries map[string]streamEntry
}

var streams = &tokenStore{entries: map[string]streamEntry{}}

// store registers an upstream URL. A token is derived from the URL path so
// segment URLs stay stable across playlist reloads even when the provider
// rotates the auth query.
func (s *tokenStore) store(rawURL string) string {
	key := rawURL
	if u, err := url.Parse(rawURL); err == nil {
		u.RawQuery = ""
		u.Fragment = ""
		key = u.String()
	}
	sum := sha256.Sum256([]byte(key))
	token := hex.EncodeToString(sum[:9])

	s.mu.Lock()
	if len(s.entries) >= maxStreamURL {
		cutoff := time.Now().Add(-streamTTL)
		for k, v := range s.entries {
			if v.at.Before(cutoff) {
				delete(s.entries, k)
			}
		}
		if len(s.entries) >= maxStreamURL {
			s.entries = make(map[string]streamEntry, maxStreamURL)
		}
	}
	existingSubs := s.entries[token].subtitles
	s.entries[token] = streamEntry{url: rawURL, at: time.Now(), subtitles: existingSubs}
	s.mu.Unlock()
	return token
}

func (s *tokenStore) attachSubtitles(playlistURL string, subs []subtitleTrack) {
	if playlistURL == "" || len(subs) == 0 {
		return
	}
	idx := strings.LastIndex(playlistURL, "/v1/stream/")
	if idx < 0 {
		return
	}
	token := strings.TrimSpace(playlistURL[idx+len("/v1/stream/"):])
	if q := strings.IndexAny(token, "?#"); q >= 0 {
		token = token[:q]
	}
	if token == "" {
		return
	}
	copied := make([]subtitleTrack, len(subs))
	copy(copied, subs)
	s.mu.Lock()
	if e, ok := s.entries[token]; ok {
		e.subtitles = copied
		s.entries[token] = e
	}
	s.mu.Unlock()
}

func (s *tokenStore) get(token string) (streamEntry, bool) {
	s.mu.RLock()
	e, ok := s.entries[token]
	s.mu.RUnlock()
	if !ok || time.Since(e.at) > streamTTL {
		return streamEntry{}, false
	}
	return e, true
}

func (s *tokenStore) sweep() {
	cutoff := time.Now().Add(-streamTTL)
	s.mu.Lock()
	for k, v := range s.entries {
		if v.at.Before(cutoff) {
			delete(s.entries, k)
		}
	}
	s.mu.Unlock()
}

func proxyURL(base, raw string) string {
	return base + "/v1/stream/" + streams.store(raw)
}

func baseOf(r *http.Request) string {
	if v := strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

var uriAttr = regexp.MustCompile(`URI="([^"]+)"`)

func absoluteURL(base *url.URL, ref string) string {
	u, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return u.String()
}

func rewritePlaylist(publicBase string, body []byte, source string) []byte {
	return rewritePlaylistWithSubtitles(publicBase, body, source, nil)
}

func sanitizeHLSAttr(s string) string {
	s = strings.ReplaceAll(s, `"`, `'`)
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func rewritePlaylistWithSubtitles(publicBase string, body []byte, source string, subs []subtitleTrack) []byte {
	base, _ := url.Parse(source)
	lineURL := func(raw string) string {
		abs := absoluteURL(base, raw)
		if abs == "" {
			return ""
		}
		return proxyURL(publicBase, abs)
	}
	lines := strings.Split(string(body), "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			if !strings.Contains(trimmed, `URI="`) {
				continue
			}
			lines[i] = uriAttr.ReplaceAllStringFunc(line, func(m string) string {
				ref := m[len(`URI="`) : len(m)-1]
				if link := lineURL(ref); link != "" {
					return `URI="` + link + `"`
				}
				return m
			})
			continue
		}
		if link := lineURL(trimmed); link != "" {
			lines[i] = link
		}
	}

	joined := strings.Join(lines, "\n")
	upper := strings.ToUpper(joined)
	isMaster := strings.Contains(upper, "#EXT-X-STREAM-INF:")
	if len(subs) == 0 || !isMaster || strings.Contains(upper, "TYPE=SUBTITLES") {
		return []byte(joined)
	}

	subBase := strings.TrimRight(publicBase, "/")
	mediaLines := make([]string, 0, len(subs))
	for _, s := range subs {
		if s.ID == "" {
			continue
		}
		lang := sanitizeHLSAttr(s.Language)
		if lang == "" {
			lang = "und"
		}
		name := sanitizeHLSAttr(s.Label)
		if name == "" {
			name = lang
		}
		uri := subBase + "/v1/subtitle/" + s.ID + ".m3u8"
		mediaLines = append(mediaLines, `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="biralosubs",NAME="`+name+`",LANGUAGE="`+lang+`",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="`+uri+`"`)
	}
	if len(mediaLines) == 0 {
		return []byte(joined)
	}

	out := make([]string, 0, len(lines)+len(mediaLines))
	inserted := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		trimmedUpper := strings.ToUpper(trimmed)
		if !inserted && strings.HasPrefix(trimmedUpper, "#EXT-X-STREAM-INF:") {
			out = append(out, mediaLines...)
			inserted = true
		}
		if strings.HasPrefix(trimmedUpper, "#EXT-X-STREAM-INF:") && !strings.Contains(trimmedUpper, "SUBTITLES=") {
			line = strings.TrimRight(line, "\r") + `,SUBTITLES="biralosubs"`
		}
		out = append(out, line)
	}
	return []byte(strings.Join(out, "\n"))
}

func looksLikeMP4(head []byte) bool {
	if len(head) < 8 {
		return false
	}
	switch string(head[4:8]) {
	case "ftyp", "styp", "moof", "moov", "mdat":
		return true
	}
	return false
}

func handleStreamProxy(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	entry, ok := streams.get(token)
	if !ok {
		writeError(w, http.StatusNotFound, "stream_not_found", "This stream link has expired or does not exist.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	req, err := upstreamRequest(ctx, r.Method, entry.url)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream_error", "The upstream provider rejected the stream request.")
		return
	}
	if isSource2URL(entry.url) {
		req.Header.Set("Referer", source2Player+"/")
		req.Header.Set("Origin", source2Player)
	}
	if rg := r.Header.Get("Range"); rg != "" {
		req.Header.Set("Range", rg)
	}

	resp, err := upstreamClient.Do(req)
	if err != nil {
		logUpstream("stream", entry.url, err)
		writeError(w, http.StatusBadGateway, "upstream_error", "The upstream provider did not answer.")
		return
	}
	defer resp.Body.Close()

	reader := bufio.NewReaderSize(resp.Body, 64*1024)
	head, _ := reader.Peek(16)
	playlist := strings.Contains(resp.Header.Get("Content-Type"), "mpegurl") ||
		strings.HasSuffix(strings.ToLower(mustPath(entry.url)), ".m3u8") ||
		isM3U(head)

	if playlist && resp.StatusCode < 400 {
		body, err := io.ReadAll(io.LimitReader(reader, 16<<20))
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "The upstream playlist could not be read.")
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		w.Write(rewritePlaylistWithSubtitles(baseOf(r), body, entry.url, entry.subtitles))
		return
	}

	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	if looksLikeMP4(head) {
		ct := strings.ToLower(w.Header().Get("Content-Type"))
		if ct == "" || strings.Contains(ct, "text/html") {
			w.Header().Set("Content-Type", "video/mp4")
		}
	}
	if resp.StatusCode < 400 {
		w.Header().Set("Cache-Control", "private, max-age=30")
	}
	w.WriteHeader(resp.StatusCode)
	io.CopyBuffer(w, reader, make([]byte, 256*1024))
}

func mustPath(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Path
}

func isM3U(body []byte) bool {
	head := strings.TrimSpace(string(body))
	return strings.HasPrefix(head, "#EXTM3U")
}
