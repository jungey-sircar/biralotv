package main

// Source 1 provider.
//
// Source 1 needs a short lived seed token and a per-mirror sources call. The
// mirrors do not share one catalogue, so a title that is missing from the
// first mirror can still resolve on the next one.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	mediaBase = "https://api.wecollege.net"
	metaBase  = "https://db.wecollege.net/3"
)

var allowedMirrors = map[string]bool{
	"miami": true, "boise": true, "vegas": true, "seattle": true, "houston": true,
	"phoenix": true, "atlanta": true, "portland": true, "austin": true, "dallas": true,
	"tampa": true, "orlando": true, "munich": true, "berlin": true, "paris": true,
	"delhi": true, "cancun": true,
}

func validMirror(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	if allowedMirrors[n] {
		return n
	}
	return "miami"
}

// Source 1 answers per mirror. Try the requested one first, then enough
// alternates to cover a title the first mirror does not carry.
var source1Mirrors = []string{"miami", "delhi", "berlin", "paris", "munich"}

const source1Tries = 4

func mirrorOrder(requested string) []string {
	order := make([]string, 0, source1Tries)
	order = append(order, requested)
	for _, mirror := range source1Mirrors {
		if mirror == requested {
			continue
		}
		order = append(order, mirror)
		if len(order) == source1Tries {
			break
		}
	}
	return order
}

type seedEntry struct {
	seed string
	at   time.Time
}

var seedStore = struct {
	sync.Mutex
	m map[string]seedEntry
}{m: map[string]seedEntry{}}

const seedTTL = 25 * time.Second

func seedFor(ctx context.Context, id string) (string, error) {
	seedStore.Lock()
	if e, ok := seedStore.m[id]; ok && time.Since(e.at) < seedTTL {
		seedStore.Unlock()
		return e.seed, nil
	}
	seedStore.Unlock()

	m, err := fetchObject(ctx, fmt.Sprintf("%s/seed?mediaId=%s", mediaBase, url.QueryEscape(id)))
	if err != nil {
		return "", err
	}
	seed, _ := m["seed"].(string)
	if seed == "" {
		return "", fmt.Errorf("empty seed")
	}

	seedStore.Lock()
	seedStore.m[id] = seedEntry{seed: seed, at: time.Now()}
	seedStore.Unlock()
	return seed, nil
}

func sweepSeeds() {
	cutoff := time.Now().Add(-2 * seedTTL)
	seedStore.Lock()
	for k, e := range seedStore.m {
		if e.at.Before(cutoff) {
			delete(seedStore.m, k)
		}
	}
	seedStore.Unlock()
}

func fetchSources(ctx context.Context, mirror, kind, id string, season, episode int, seed, imdbID string) (string, error) {
	q := url.Values{}
	q.Set("title", "")
	q.Set("mediaType", kind)
	q.Set("year", "")
	q.Set("totalSeasons", "0")
	q.Set("episodeId", strconv.Itoa(episode))
	q.Set("seasonId", strconv.Itoa(season))
	q.Set("tmdbId", id)
	q.Set("imdbId", imdbID)
	q.Set("enc", "2")
	q.Set("seed", seed)
	return fetchText(ctx, fmt.Sprintf("%s/%s/sources?%s", mediaBase, mirror, q.Encode()))
}

var imdbCache sync.Map // "movie:157336" -> "tt0816692"

var errNoStreams = fmt.Errorf("no streams")

func imdbFor(ctx context.Context, kind, id string) (string, error) {
	key := kind + ":" + id
	if v, ok := imdbCache.Load(key); ok {
		return v.(string), nil
	}
	raw, err := fetchText(ctx, fmt.Sprintf("%s/%s/%s/external_ids", metaBase, kind, id))
	if err != nil {
		return "", err
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return "", err
	}
	imdb, _ := obj["imdb_id"].(string)
	if imdb == "" {
		return "", &upstreamStatus{http.StatusNotFound}
	}
	imdbCache.Store(key, imdb)
	return imdb, nil
}

func resolveSource1(ctx context.Context, base, kind, id string, season, episode int, mirror string) (*resolvedMedia, error) {
	seed, err := seedFor(ctx, id)
	if err != nil {
		return nil, err
	}
	imdbID, _ := imdbFor(ctx, kind, id)

	var lastErr error = errNoStreams
	for _, candidate := range mirrorOrder(validMirror(mirror)) {
		payload, err := payloadFromMirror(ctx, base, kind, id, season, episode, candidate, seed, imdbID)
		if err == nil {
			return payload, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func payloadFromMirror(ctx context.Context, base, kind, id string, season, episode int, mirror, seed, imdbID string) (*resolvedMedia, error) {
	attempt, cancel := context.WithTimeout(ctx, 8*time.Second)
	encrypted, err := fetchSources(attempt, mirror, kind, id, season, episode, seed, imdbID)
	cancel()
	if err != nil {
		return nil, err
	}
	decrypted, err := jsDecrypt(encrypted, seed, id)
	if err != nil {
		return nil, err
	}
	var src map[string]interface{}
	if err := json.Unmarshal([]byte(decrypted), &src); err != nil {
		return nil, err
	}

	payload := &resolvedMedia{
		Type:       kind,
		Season:     season,
		Episode:    episode,
		ResolvedBy: mirror,
		Streams:    []streamVariant{},
	}
	if kind == "movie" {
		payload.Season = 0
		payload.Episode = 0
	}
	if playlist, ok := src["playlist"].(string); ok && playlist != "" {
		payload.Playlist = proxyURL(base, playlist)
	}
	for _, item := range toObjectArray(src["sources"]) {
		quality, _ := item["quality"].(string)
		raw, _ := item["url"].(string)
		if raw == "" {
			continue
		}
		if quality == "" {
			quality = "auto"
		}
		payload.Streams = append(payload.Streams, streamVariant{Quality: quality, URL: proxyURL(base, raw)})
	}
	if len(payload.Streams) == 0 && payload.Playlist == "" {
		return nil, errNoStreams
	}
	if thumb, ok := src["thumbnail"].(string); ok && thumb != "" {
		payload.Thumbnails = proxyURL(base, thumb)
	}

	subs := extractGenericSubtitles(base, src, "server1", "https://www.vidy.st/", "https://www.vidy.st")
	if len(subs) == 0 {
		subs, _ = fetchOpenSubtitlesWithTimeout(ctx, base, kind, id, season, episode, imdbID, 4*time.Second)
	}
	subs = finalizeSubtitles(subs)
	payload.Subtitles = subs
	rememberTitleSubtitles(kind, id, season, episode, imdbID, subs)
	if payload.Playlist != "" {
		streams.attachSubtitles(payload.Playlist, subs)
	}
	return payload, nil
}

func firstNonEmptyString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func extractGenericSubtitles(base string, src map[string]interface{}, sourceName, referer, origin string) []subtitleTrack {
	var rawItems []map[string]interface{}
	for _, key := range []string{"subtitles", "tracks", "captions"} {
		if arr := toObjectArray(src[key]); len(arr) > 0 {
			rawItems = append(rawItems, arr...)
		}
	}
	if len(rawItems) == 0 {
		return nil
	}
	out := make([]subtitleTrack, 0, len(rawItems))
	for _, item := range rawItems {
		kind, _ := item["kind"].(string)
		if kind != "" && !strings.EqualFold(kind, "subtitles") && !strings.EqualFold(kind, "captions") && !strings.EqualFold(kind, "builtin") {
			continue
		}
		rawURL := firstNonEmptyString(item, "url", "file", "src")
		if rawURL == "" {
			continue
		}
		rawLang := firstNonEmptyString(item, "lang", "language", "srclang", "code")
		rawLabel := firstNonEmptyString(item, "label", "name", "title", "language", "lang")
		if track, ok := registerSubtitle(base, rawURL, rawLang, rawLabel, sourceName, referer, origin); ok {
			out = append(out, track)
		}
	}
	return out
}

func toObjectArray(v interface{}) []map[string]interface{} {
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}
