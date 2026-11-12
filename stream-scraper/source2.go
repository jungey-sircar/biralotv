package main

// Source 2 and source 3 catalog scraper.
//
// The catalog page only boots a player. The useful chain is:
//
//   GET  /tv|movie/{tmdb}        -> embdmstrplayer.com/v2/{ticket page}
//   POST /v2/{ticket} tr=        -> player HTML with an obfuscated config
//   GET  {feedUrl}{scrapeToken}  -> NDJSON server list
//   GET  /v2/api/resolve.php     -> encrypted HLS URL for one server
//
// Only the final HLS URL is handed to the viewer, and only through the same
// capability route as the other providers. Tickets, feed tokens and encrypted
// source URLs never leave this process.

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	source2Site      = "https://embedmaster.link"
	source2Player    = "https://embdmstrplayer.com"
	source2Primary   = 85
	source2Secondary = 80
)

var (
	source2PageTransport = newTransport(true)
	errSource2NoSource   = errors.New("source2: no primary or secondary catalog source")
)

type source2Config struct {
	Ticket        string `json:"ticket"`
	PK            string `json:"pk"`
	ScrapeToken   string `json:"scrapeToken"`
	FeedURL       string `json:"feedUrl"`
	FeedURLBackup string `json:"feedUrlBackup"`
	ResolveURL    string `json:"resolveUrl"`
}

type source2Server struct {
	Type       string          `json:"type"`
	SourceType json.RawMessage `json:"source_type"`
	SourceURL  string          `json:"source_url"`
	Quality    string          `json:"source_quality"`
}

type source2Subtitle struct {
	Label string `json:"label"`
	Lang  string `json:"lang"`
	URL   string `json:"url"`
}

type source2Resolve struct {
	OK        bool              `json:"ok"`
	Error     string            `json:"error"`
	URL       string            `json:"url"`
	Type      string            `json:"type"`
	Quality   string            `json:"quality"`
	Subtitles []source2Subtitle `json:"subtitles"`
}

// buildSource2Payload resolves one title through the primary catalog first and
// the secondary catalog second. A feed entry that exists but cannot be resolved
// is treated as missing, so the fallback still gets a turn.
func buildSource2Payload(ctx context.Context, base, kind, id string, season, episode int) (*resolvedMedia, error) {
	return buildCatalogPayload(ctx, base, kind, id, season, episode, []int{source2Primary, source2Secondary}, errSource2NoSource)
}

func buildCatalogPayload(ctx context.Context, base, kind, id string, season, episode int, sourceTypes []int, noSource error) (*resolvedMedia, error) {
	cfg, pageURL, err := source2PlayerConfig(ctx, kind, id, season, episode)
	if err != nil {
		return nil, err
	}

	servers, err := source2Servers(ctx, cfg)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, server := range chooseCandidates(servers, sourceTypes) {
		sourceType := server.typeID()
		resolved, resolveErr := source2ResolveSource(ctx, cfg, pageURL, server.SourceURL)
		if resolveErr != nil {
			lastErr = resolveErr
			continue
		}
		if resolved.URL == "" {
			lastErr = noSource
			continue
		}

		playURL := proxyURL(base, resolved.URL)
		quality := strings.TrimSpace(resolved.Quality)
		if quality == "" {
			quality = strings.TrimSpace(server.Quality)
		}
		if quality == "" {
			quality = "auto"
		}
		name := "primary"
		subSource := "server2"
		if sourceType == source2Secondary {
			name = "secondary"
			subSource = "server3"
		}
		subs := make([]subtitleTrack, 0, len(resolved.Subtitles))
		for _, item := range resolved.Subtitles {
			if track, ok := registerSubtitle(base, item.URL, item.Lang, item.Label, subSource, source2Player+"/", source2Player); ok {
				subs = append(subs, track)
			}
		}
		if len(subs) == 0 {
			subs, _ = fetchOpenSubtitlesWithTimeout(ctx, base, kind, id, season, episode, "", 4*time.Second)
		}
		subs = finalizeSubtitles(subs)
		rememberTitleSubtitles(kind, id, season, episode, "", subs)
		streams.attachSubtitles(playURL, subs)

		return &resolvedMedia{
			Type:       kind,
			Season:     season,
			Episode:    episode,
			ResolvedBy: name,
			Playlist:   playURL,
			Streams:    []streamVariant{{Quality: quality, URL: playURL}},
			Subtitles:  subs,
		}, nil
	}
	if lastErr == nil {
		lastErr = noSource
	}
	return nil, lastErr
}

// source2Candidates is the server policy in one place: primary catalog entries
// first, secondary catalog entries second, everything else ignored.
func source2Candidates(servers []source2Server) []source2Server {
	return chooseCandidates(servers, []int{source2Primary, source2Secondary})
}

// chooseCandidates keeps only the listed source types and preserves their order.
func chooseCandidates(servers []source2Server, sourceTypes []int) []source2Server {
	out := make([]source2Server, 0, len(servers))
	for _, sourceType := range sourceTypes {
		for _, server := range servers {
			if server.typeID() == sourceType && server.SourceURL != "" {
				out = append(out, server)
			}
		}
	}
	return out
}

func (s source2Server) typeID() int {
	raw := strings.TrimSpace(strings.Trim(string(s.SourceType), `"`))
	n, _ := strconv.Atoi(raw)
	return n
}

func source2PageURL(kind, id string, season, episode int) string {
	if kind == "tv" {
		return fmt.Sprintf("%s/tv/%s/%d/%d", source2Site, url.PathEscape(id), season, episode)
	}
	return fmt.Sprintf("%s/movie/%s", source2Site, url.PathEscape(id))
}

// source2PlayerConfig loads the welcome page, spends its POST form and extracts
// the config blob. The site currently accepts an empty Turnstile token for
// this flow; a future proof-of-work challenge will fail here, not silently
// return someone else's stream.
func source2PlayerConfig(ctx context.Context, kind, id string, season, episode int) (*source2Config, string, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Transport: source2PageTransport, Jar: jar}

	pageURL := source2PageURL(kind, id, season, episode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", source2Site+"/")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	resp.Body.Close()
	if readErr != nil {
		return nil, "", readErr
	}
	if resp.StatusCode >= 400 {
		return nil, "", &upstreamStatus{resp.StatusCode}
	}
	finalURL := resp.Request.URL.String()
	if cfg, cfgErr := parseSource2Config(body); cfgErr == nil {
		return cfg, finalURL, nil
	}

	postReq, err := http.NewRequestWithContext(ctx, http.MethodPost, finalURL, strings.NewReader("tr="))
	if err != nil {
		return nil, "", err
	}
	postReq.Header.Set("User-Agent", browserUA)
	postReq.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	postReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	postReq.Header.Set("Origin", source2Player)
	postReq.Header.Set("Referer", finalURL)

	postResp, err := client.Do(postReq)
	if err != nil {
		return nil, "", err
	}
	postBody, readErr := io.ReadAll(io.LimitReader(postResp.Body, 32<<20))
	postResp.Body.Close()
	if readErr != nil {
		return nil, "", readErr
	}
	if postResp.StatusCode >= 400 {
		return nil, "", &upstreamStatus{postResp.StatusCode}
	}
	cfg, err := parseSource2Config(postBody)
	if err != nil {
		return nil, "", err
	}
	return cfg, postResp.Request.URL.String(), nil
}

var (
	source2ConfigScript = regexp.MustCompile(`(?s)var\s+_\w+\s*=\s*"([A-Za-z0-9+/=_-]+)"\s*,\s*_\w+\s*=\s*\[([0-9,\s]+)\]\s*,\s*_\w+\s*=\s*(\d+)`)
	source2ConfigAssign = regexp.MustCompile(`window\s*\.\s*__EM_PLAYER__\s*=\s*`)
)

// parseSource2Config reverses the XOR wrapper around the inline config. This is
// deliberately a decoder, not an evaluator: the page only needs its own blob
// decoded, not arbitrary JavaScript run on the API host.
func parseSource2Config(page []byte) (*source2Config, error) {
	m := source2ConfigScript.FindSubmatch(page)
	if len(m) != 4 {
		return nil, errors.New("source2: config blob not found")
	}
	raw, err := decodeBase64(string(m[1]))
	if err != nil {
		return nil, fmt.Errorf("source2: config blob: %w", err)
	}
	key := strings.Split(string(m[2]), ",")
	keyBytes := make([]byte, 0, len(key))
	for _, item := range key {
		n, convErr := strconv.Atoi(strings.TrimSpace(item))
		if convErr != nil {
			return nil, errors.New("source2: config key invalid")
		}
		keyBytes = append(keyBytes, byte(n))
	}
	if len(keyBytes) == 0 {
		return nil, errors.New("source2: config key empty")
	}
	base, err := strconv.Atoi(string(m[3]))
	if err != nil {
		return nil, errors.New("source2: config base invalid")
	}

	decoded := make([]byte, len(raw))
	for i, b := range raw {
		decoded[i] = b ^ byte((base+int(keyBytes[i%len(keyBytes)])+i)&0xff)
	}

	loc := source2ConfigAssign.FindIndex(decoded)
	if loc == nil {
		return nil, errors.New("source2: config assignment not found")
	}
	var cfg source2Config
	dec := json.NewDecoder(strings.NewReader(string(decoded[loc[1]:])))
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("source2: config json: %w", err)
	}
	if cfg.Ticket == "" || cfg.PK == "" || cfg.ScrapeToken == "" || cfg.FeedURL == "" || cfg.ResolveURL == "" {
		return nil, errors.New("source2: config incomplete")
	}
	return &cfg, nil
}

func decodeBase64(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if raw, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.StdEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	return base64.URLEncoding.DecodeString(value)
}

func source2FeedURL(base, token string) string {
	return strings.TrimRight(base, "/") + "/" + url.PathEscape(token)
}

func source2Servers(ctx context.Context, cfg *source2Config) ([]source2Server, error) {
	var firstErr error
	for _, base := range []string{cfg.FeedURL, cfg.FeedURLBackup} {
		if base == "" {
			continue
		}
		servers, err := source2FetchServers(ctx, source2FeedURL(base, cfg.ScrapeToken))
		if err == nil && len(servers) > 0 {
			return servers, nil
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return nil, errSource2NoSource
}

func source2FetchServers(ctx context.Context, feedURL string) ([]source2Server, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/x-ndjson")
	req.Header.Set("Referer", source2Player+"/")

	resp, err := textClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, &upstreamStatus{resp.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}

	servers := make([]source2Server, 0, 8)
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] != '{' {
			continue
		}
		var server source2Server
		if err := json.Unmarshal([]byte(line), &server); err != nil {
			continue
		}
		if server.Type == "server" && server.SourceURL != "" {
			servers = append(servers, server)
		}
	}
	return servers, nil
}

func source2ResolveSource(ctx context.Context, cfg *source2Config, pageURL, sourceURL string) (*source2Resolve, error) {
	base, err := url.Parse(pageURL)
	if err != nil {
		return nil, err
	}
	ref, err := url.Parse(cfg.ResolveURL)
	if err != nil {
		return nil, err
	}
	resolveURL := base.ResolveReference(ref)
	q := resolveURL.Query()
	q.Set("src", sourceURL)
	resolveURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, resolveURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Referer", pageURL)
	req.Header.Set("X-EM-Player", "1")
	req.Header.Set("X-EM-Ticket", cfg.Ticket)

	resp, err := textClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, &upstreamStatus{resp.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	plain := body
	if trimmed := strings.TrimSpace(string(body)); trimmed != "" && trimmed[0] != '{' {
		plain, err = source2Decrypt(trimmed, cfg.PK)
		if err != nil {
			return nil, err
		}
	}
	var resolved source2Resolve
	if err := json.Unmarshal(plain, &resolved); err != nil {
		return nil, err
	}
	if !resolved.OK {
		if resolved.Error != "" {
			return nil, fmt.Errorf("source2: %s", resolved.Error)
		}
		return nil, errSource2NoSource
	}
	return &resolved, nil
}

// source2Decrypt is the resolve endpoint's response cipher:
// base64url(nonce || ciphertext), stream = SHA-256(pk || nonce || be32(counter)).
// PK is the 32-byte hex value in the page config.
func source2Decrypt(encoded, pkHex string) ([]byte, error) {
	key, err := hex.DecodeString(strings.TrimSpace(pkHex))
	if err != nil || len(key) == 0 {
		return nil, errors.New("source2: invalid response key")
	}
	raw, err := decodeBase64URL(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) < 17 {
		return nil, errors.New("source2: response too short")
	}
	nonce := raw[:16]
	data := raw[16:]
	out := make([]byte, len(data))
	var counter [4]byte
	for block := 0; block*sha256.Size < len(data); block++ {
		binary.BigEndian.PutUint32(counter[:], uint32(block))
		h := sha256.New()
		h.Write(key)
		h.Write(nonce)
		h.Write(counter[:])
		stream := h.Sum(nil)
		start := block * sha256.Size
		for i := 0; i < sha256.Size && start+i < len(data); i++ {
			out[start+i] = data[start+i] ^ stream[i]
		}
	}
	return out, nil
}

func decodeBase64URL(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if raw, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.URLEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	if raw, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	return base64.StdEncoding.DecodeString(value)
}

// isSource2URL keeps the catalog CDN's required referer on proxied
// playlists and segments. The hosts rotate; the suffix check covers the media
// hosts.
func isSource2URL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "perfectbussines.website" ||
		host == "embdmstrplayer.com" ||
		host == "scrapemaster.net" ||
		strings.HasSuffix(host, ".scrapemaster.net") ||
		strings.HasSuffix(host, ".embdmstrplayer.com")
}
