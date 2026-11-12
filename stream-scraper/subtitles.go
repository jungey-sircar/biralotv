package main

// Subtitle discovery, normalization (SRT -> WebVTT) and proxy endpoints.
//
// Providers (Source 1/2/3) often include built-in WebVTT tracks matched to the
// exact encode. When they do (or when they don't), tracks are registered behind
// /v1/subtitle/{token}.vtt and optionally exposed via /v1/subtitle/{token}.m3u8
// for HLS players (Android ExoPlayer fullscreen / native CC menus). A keyless
// OpenSubtitles v3 lookup acts as a fallback and supplements /v1/subtitles/...
// lookups by TMDB/IMDb id.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var openSubtitlesBaseURL = "https://opensubtitles-v3.strem.io"

const (
	subtitleTTL        = 4 * time.Hour
	maxSubtitleEntries = 20000
	subBodyTTL         = 30 * time.Minute
	maxSubBodyCache    = 64
	titleSubsTTL       = 20 * time.Minute
	maxTitleSubsCache  = 256
)

type subtitleEntry struct {
	url     string
	referer string
	origin  string
	format  string
	source  string
	at      time.Time
}

type subTokenStore struct {
	mu      sync.RWMutex
	entries map[string]subtitleEntry
}

var subtitlesStore = &subTokenStore{entries: map[string]subtitleEntry{}}

type subBodyEntry struct {
	vtt []byte
	at  time.Time
}

var subBodyCache = struct {
	mu sync.Mutex
	m  map[string]subBodyEntry
}{m: map[string]subBodyEntry{}}

type cachedTitleSub struct {
	id       string
	language string
	label    string
	rawURL   string
	referer  string
	origin   string
	format   string
	source   string
}

type titleSubsEntry struct {
	tracks []cachedTitleSub
	imdbID string
	at     time.Time
}

var titleSubsCache = struct {
	mu sync.Mutex
	m  map[string]titleSubsEntry
}{m: map[string]titleSubsEntry{}}

func (s *subTokenStore) store(rawURL, referer, origin, format, source string) string {
	key := rawURL
	if u, err := url.Parse(rawURL); err == nil {
		// Preserve full URL when it differs significantly (keep query if short/distinct? Wait:
		// OpenSubtitles file IDs are in the path; Source 1/2 use distinct path per language).
		u.Fragment = ""
		key = u.String()
	}
	sum := sha256.Sum256([]byte("sub|" + key))
	token := hex.EncodeToString(sum[:9])

	s.mu.Lock()
	if len(s.entries) >= maxSubtitleEntries {
		cutoff := time.Now().Add(-subtitleTTL)
		for k, v := range s.entries {
			if v.at.Before(cutoff) {
				delete(s.entries, k)
			}
		}
		if len(s.entries) >= maxSubtitleEntries {
			s.entries = make(map[string]subtitleEntry, maxSubtitleEntries)
		}
	}
	s.entries[token] = subtitleEntry{
		url:     rawURL,
		referer: referer,
		origin:  origin,
		format:  format,
		source:  source,
		at:      time.Now(),
	}
	s.mu.Unlock()
	return token
}

func (s *subTokenStore) get(token string) (subtitleEntry, bool) {
	s.mu.RLock()
	e, ok := s.entries[token]
	s.mu.RUnlock()
	if !ok || time.Since(e.at) > subtitleTTL {
		return subtitleEntry{}, false
	}
	return e, true
}

func sweepSubtitles() {
	cutoff := time.Now().Add(-subtitleTTL)
	subtitlesStore.mu.Lock()
	for k, v := range subtitlesStore.entries {
		if v.at.Before(cutoff) {
			delete(subtitlesStore.entries, k)
		}
	}
	subtitlesStore.mu.Unlock()

	bodyCutoff := time.Now().Add(-subBodyTTL)
	subBodyCache.mu.Lock()
	for k, v := range subBodyCache.m {
		if v.at.Before(bodyCutoff) {
			delete(subBodyCache.m, k)
		}
	}
	subBodyCache.mu.Unlock()

	titleCutoff := time.Now().Add(-titleSubsTTL)
	titleSubsCache.mu.Lock()
	for k, v := range titleSubsCache.m {
		if v.at.Before(titleCutoff) {
			delete(titleSubsCache.m, k)
		}
	}
	titleSubsCache.mu.Unlock()
}

type langMeta struct {
	code string
	name string
}

var langLookup = map[string]langMeta{
	"en": {"en", "English"}, "eng": {"en", "English"}, "english": {"en", "English"},
	"es": {"es", "Spanish"}, "spa": {"es", "Spanish"}, "spanish": {"es", "Spanish"}, "esp": {"es", "Spanish"},
	"fr": {"fr", "French"}, "fre": {"fr", "French"}, "fra": {"fr", "French"}, "french": {"fr", "French"},
	"de": {"de", "German"}, "ger": {"de", "German"}, "deu": {"de", "German"}, "german": {"de", "German"},
	"pt": {"pt", "Portuguese"}, "por": {"pt", "Portuguese"}, "portuguese": {"pt", "Portuguese"},
	"pt-br": {"pt-BR", "Portuguese (BR)"}, "pob": {"pt-BR", "Portuguese (BR)"}, "pb": {"pt-BR", "Portuguese (BR)"},
	"it": {"it", "Italian"}, "ita": {"it", "Italian"}, "italian": {"it", "Italian"},
	"ar": {"ar", "Arabic"}, "ara": {"ar", "Arabic"}, "arabic": {"ar", "Arabic"},
	"hi": {"hi", "Hindi"}, "hin": {"hi", "Hindi"}, "hindi": {"hi", "Hindi"},
	"ja": {"ja", "Japanese"}, "jpn": {"ja", "Japanese"}, "japanese": {"ja", "Japanese"},
	"ko": {"ko", "Korean"}, "kor": {"ko", "Korean"}, "korean": {"ko", "Korean"},
	"zh": {"zh", "Chinese"}, "chi": {"zh", "Chinese"}, "zho": {"zh", "Chinese"}, "chinese": {"zh", "Chinese"}, "zht": {"zh-TW", "Chinese (Traditional)"}, "zhs": {"zh-CN", "Chinese (Simplified)"},
	"ru": {"ru", "Russian"}, "rus": {"ru", "Russian"}, "russian": {"ru", "Russian"},
	"tr": {"tr", "Turkish"}, "tur": {"tr", "Turkish"}, "turkish": {"tr", "Turkish"},
	"id": {"id", "Indonesian"}, "ind": {"id", "Indonesian"}, "indonesian": {"id", "Indonesian"},
	"vi": {"vi", "Vietnamese"}, "vie": {"vi", "Vietnamese"}, "vietnamese": {"vi", "Vietnamese"},
	"th": {"th", "Thai"}, "tha": {"th", "Thai"}, "thai": {"th", "Thai"},
	"pl": {"pl", "Polish"}, "pol": {"pl", "Polish"}, "polish": {"pl", "Polish"},
	"nl": {"nl", "Dutch"}, "dut": {"nl", "Dutch"}, "nld": {"nl", "Dutch"}, "dutch": {"nl", "Dutch"},
	"uk": {"uk", "Ukrainian"}, "ukr": {"uk", "Ukrainian"}, "ukrainian": {"uk", "Ukrainian"},
	"he": {"he", "Hebrew"}, "heb": {"he", "Hebrew"}, "hebrew": {"he", "Hebrew"},
	"el": {"el", "Greek"}, "gre": {"el", "Greek"}, "ell": {"el", "Greek"}, "greek": {"el", "Greek"},
	"ro": {"ro", "Romanian"}, "rum": {"ro", "Romanian"}, "ron": {"ro", "Romanian"}, "romanian": {"ro", "Romanian"},
	"hu": {"hu", "Hungarian"}, "hun": {"hu", "Hungarian"}, "hungarian": {"hu", "Hungarian"},
	"cs": {"cs", "Czech"}, "cze": {"cs", "Czech"}, "ces": {"cs", "Czech"}, "czech": {"cs", "Czech"},
	"da": {"da", "Danish"}, "dan": {"da", "Danish"}, "danish": {"da", "Danish"},
	"fi": {"fi", "Finnish"}, "fin": {"fi", "Finnish"}, "finnish": {"fi", "Finnish"},
	"no": {"no", "Norwegian"}, "nor": {"no", "Norwegian"}, "nob": {"no", "Norwegian"}, "norwegian": {"no", "Norwegian"},
	"sv": {"sv", "Swedish"}, "swe": {"sv", "Swedish"}, "swedish": {"sv", "Swedish"},
	"bg": {"bg", "Bulgarian"}, "bul": {"bg", "Bulgarian"}, "bulgarian": {"bg", "Bulgarian"},
	"hr": {"hr", "Croatian"}, "hrv": {"hr", "Croatian"}, "croatian": {"hr", "Croatian"},
	"sr": {"sr", "Serbian"}, "srp": {"sr", "Serbian"}, "scc": {"sr", "Serbian"}, "serbian": {"sr", "Serbian"},
	"sk": {"sk", "Slovak"}, "slo": {"sk", "Slovak"}, "slk": {"sk", "Slovak"}, "slovak": {"sk", "Slovak"},
	"sl": {"sl", "Slovenian"}, "slv": {"sl", "Slovenian"}, "slovenian": {"sl", "Slovenian"},
	"et": {"et", "Estonian"}, "est": {"et", "Estonian"}, "estonian": {"et", "Estonian"},
	"lt": {"lt", "Lithuanian"}, "lit": {"lt", "Lithuanian"}, "lithuanian": {"lt", "Lithuanian"},
	"lv": {"lv", "Latvian"}, "lav": {"lv", "Latvian"}, "latvian": {"lv", "Latvian"},
	"ms": {"ms", "Malay"}, "may": {"ms", "Malay"}, "msa": {"ms", "Malay"}, "malay": {"ms", "Malay"},
	"fa": {"fa", "Persian"}, "per": {"fa", "Persian"}, "fas": {"fa", "Persian"}, "persian": {"fa", "Persian"},
	"bn": {"bn", "Bengali"}, "ben": {"bn", "Bengali"}, "bengali": {"bn", "Bengali"},
	"ur": {"ur", "Urdu"}, "urd": {"ur", "Urdu"}, "urdu": {"ur", "Urdu"},
	"ta": {"ta", "Tamil"}, "tam": {"ta", "Tamil"}, "tamil": {"ta", "Tamil"},
	"te": {"te", "Telugu"}, "tel": {"te", "Telugu"}, "telugu": {"te", "Telugu"},
	"ne": {"ne", "Nepali"}, "nep": {"ne", "Nepali"}, "nepali": {"ne", "Nepali"},
	"is": {"is", "Icelandic"}, "ice": {"is", "Icelandic"}, "isl": {"is", "Icelandic"}, "icelandic": {"is", "Icelandic"},
	"sq": {"sq", "Albanian"}, "alb": {"sq", "Albanian"}, "sqi": {"sq", "Albanian"}, "albanian": {"sq", "Albanian"},
	"mk": {"mk", "Macedonian"}, "mac": {"mk", "Macedonian"}, "mkd": {"mk", "Macedonian"},
	"bs": {"bs", "Bosnian"}, "bos": {"bs", "Bosnian"},
	"ka": {"ka", "Georgian"}, "geo": {"ka", "Georgian"}, "kat": {"ka", "Georgian"},
	"tl": {"tl", "Tagalog"}, "tgl": {"tl", "Tagalog"}, "fil": {"fil", "Filipino"},
	"und": {"und", "Unknown"}, "unknown": {"und", "Unknown"},
}

var langTrailingQualifier = regexp.MustCompile(`^([a-zA-Z-]+)\s*(\([^)]+\))$`)

func normalizeSubtitleLang(rawLang, rawLabel string) (code, label string) {
	langTrim := strings.TrimSpace(rawLang)
	origLangTrim := langTrim
	labelTrim := strings.TrimSpace(rawLabel)
	suffix := ""

	if m := langTrailingQualifier.FindStringSubmatch(langTrim); len(m) == 3 {
		langTrim = strings.TrimSpace(m[1])
		suffix = " " + strings.TrimSpace(m[2])
	}
	if suffix == "" {
		if m := langTrailingQualifier.FindStringSubmatch(labelTrim); len(m) == 3 {
			if strings.EqualFold(strings.TrimSpace(m[1]), langTrim) || langTrim == "" {
				suffix = " " + strings.TrimSpace(m[2])
			}
		}
	}
	key := strings.ToLower(strings.ReplaceAll(langTrim, "_", "-"))
	if key == "" && labelTrim != "" {
		labelBase := labelTrim
		if m := langTrailingQualifier.FindStringSubmatch(labelTrim); len(m) == 3 {
			labelBase = strings.TrimSpace(m[1])
		}
		key = strings.ToLower(strings.ReplaceAll(labelBase, "_", "-"))
	}
	isRawCodeLabel := func(lbl string) bool {
		if lbl == "" {
			return true
		}
		if strings.EqualFold(lbl, origLangTrim) || strings.EqualFold(lbl, langTrim) || strings.EqualFold(lbl, code) {
			return true
		}
		if m := langTrailingQualifier.FindStringSubmatch(lbl); len(m) == 3 {
			base := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(m[1]), "_", "-"))
			if _, ok := langLookup[base]; ok && len(base) <= 3 {
				return true
			}
		}
		return false
	}
	if meta, ok := langLookup[key]; ok {
		code = meta.code
		if !isRawCodeLabel(labelTrim) {
			label = labelTrim
		} else {
			label = meta.name + suffix
		}
		return code, label
	}

	// Handle subtags like en-US, es-419, chi (3)
	if base, _, ok := strings.Cut(key, "-"); ok {
		if meta, ok2 := langLookup[base]; ok2 {
			code = key
			if !isRawCodeLabel(labelTrim) {
				label = labelTrim
			} else {
				label = meta.name + suffix
			}
			return code, label
		}
	}

	if langTrim != "" {
		code = strings.ToLower(langTrim)
	} else {
		code = "und"
	}
	if labelTrim != "" {
		label = labelTrim
	} else if code != "und" {
		label = strings.ToUpper(code) + suffix
	} else {
		label = "Subtitles" + suffix
	}
	return code, label
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func detectSubFormat(rawURL string) string {
	lower := strings.ToLower(mustPath(rawURL))
	if strings.HasSuffix(lower, ".srt") {
		return "srt"
	}
	return "vtt"
}

func registerSubtitle(base, rawURL, rawLang, rawLabel, source, referer, origin string) (subtitleTrack, bool) {
	cleanURL := strings.TrimSpace(rawURL)
	if !isHTTPURL(cleanURL) {
		return subtitleTrack{}, false
	}
	code, label := normalizeSubtitleLang(rawLang, rawLabel)
	fmtName := detectSubFormat(cleanURL)
	token := subtitlesStore.store(cleanURL, referer, origin, fmtName, source)
	return subtitleTrack{
		ID:       token,
		Language: code,
		Label:    label,
		Format:   "vtt",
		URL:      strings.TrimRight(base, "/") + "/v1/subtitle/" + token + ".vtt",
		Source:   source,
	}, true
}

var languagePriority = map[string]int{
	"en": 1, "es": 2, "fr": 3, "pt": 4, "pt-BR": 5, "ar": 6, "hi": 7,
	"de": 8, "it": 9, "ja": 10, "ko": 11, "zh": 12, "ru": 13, "tr": 14,
	"id": 15, "vi": 16, "nl": 17, "pl": 18,
}

func finalizeSubtitles(tracks []subtitleTrack) []subtitleTrack {
	if len(tracks) == 0 {
		return []subtitleTrack{}
	}
	seenID := make(map[string]bool, len(tracks))
	out := make([]subtitleTrack, 0, len(tracks))
	for _, t := range tracks {
		if t.ID == "" || t.URL == "" || seenID[t.ID] {
			continue
		}
		seenID[t.ID] = true
		if strings.TrimSpace(t.Language) == "" {
			t.Language = "und"
		}
		if strings.TrimSpace(t.Label) == "" {
			t.Label = t.Language
		}
		if t.Format == "" {
			t.Format = "vtt"
		}
		out = append(out, t)
	}

	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		aExt := a.Source == "opensubtitles"
		bExt := b.Source == "opensubtitles"
		if aExt != bExt {
			return !aExt
		}
		pa, aHas := languagePriority[a.Language]
		pb, bHas := languagePriority[b.Language]
		if aHas != bHas {
			return aHas
		}
		if aHas && pb != pa {
			return pa < pb
		}
		la := strings.ToLower(a.Label)
		lb := strings.ToLower(b.Label)
		if la != lb {
			return la < lb
		}
		return a.ID < b.ID
	})

	// Keep labels unique so HLS #EXT-X-MEDIA NAME attributes and picker items stay distinct.
	usedLabels := make(map[string]bool, len(out))
	for i := range out {
		candidate := out[i].Label
		key := strings.ToLower(candidate)
		if usedLabels[key] {
			baseLabel := out[i].Label
			for n := 2; ; n++ {
				var next string
				if !strings.HasSuffix(baseLabel, ")") {
					next = fmt.Sprintf("%s (%d)", baseLabel, n)
				} else {
					next = fmt.Sprintf("%s #%d", baseLabel, n)
				}
				if !usedLabels[strings.ToLower(next)] {
					candidate = next
					key = strings.ToLower(next)
					break
				}
			}
		}
		out[i].Label = candidate
		usedLabels[key] = true
	}
	return out
}

func rememberTitleSubtitles(kind, id string, season, episode int, imdbID string, subs []subtitleTrack) {
	if len(subs) == 0 {
		return
	}
	key := fmt.Sprintf("%s:%s:%d:%d", kind, id, season, episode)
	cached := make([]cachedTitleSub, 0, len(subs))
	for _, s := range subs {
		if s.Source == "opensubtitles" {
			continue
		}
		entry, ok := subtitlesStore.get(s.ID)
		if !ok {
			continue
		}
		cached = append(cached, cachedTitleSub{
			id:       s.ID,
			language: s.Language,
			label:    s.Label,
			rawURL:   entry.url,
			referer:  entry.referer,
			origin:   entry.origin,
			format:   entry.format,
			source:   s.Source,
		})
	}
	if len(cached) == 0 {
		return
	}
	titleSubsCache.mu.Lock()
	if len(titleSubsCache.m) >= maxTitleSubsCache {
		cutoff := time.Now().Add(-titleSubsTTL)
		for k, v := range titleSubsCache.m {
			if v.at.Before(cutoff) {
				delete(titleSubsCache.m, k)
			}
		}
		if len(titleSubsCache.m) >= maxTitleSubsCache {
			titleSubsCache.m = map[string]titleSubsEntry{}
		}
	}
	titleSubsCache.m[key] = titleSubsEntry{tracks: cached, imdbID: imdbID, at: time.Now()}
	titleSubsCache.mu.Unlock()
}

func cachedTitleSubtitlesFor(base, kind, id string, season, episode int) ([]subtitleTrack, string) {
	key := fmt.Sprintf("%s:%s:%d:%d", kind, id, season, episode)
	titleSubsCache.mu.Lock()
	entry, ok := titleSubsCache.m[key]
	titleSubsCache.mu.Unlock()
	if !ok || time.Since(entry.at) > titleSubsTTL {
		return nil, ""
	}
	out := make([]subtitleTrack, 0, len(entry.tracks))
	for _, t := range entry.tracks {
		tok := subtitlesStore.store(t.rawURL, t.referer, t.origin, t.format, t.source)
		out = append(out, subtitleTrack{
			ID:       tok,
			Language: t.language,
			Label:    t.label,
			Format:   "vtt",
			URL:      strings.TrimRight(base, "/") + "/v1/subtitle/" + tok + ".vtt",
			Source:   t.source,
		})
	}
	return out, entry.imdbID
}

type openSubItem struct {
	ID            string `json:"id"`
	URL           string `json:"url"`
	Lang          string `json:"lang"`
	FileName      string `json:"subtitleFileName"`
	ReleaseFormat string `json:"releaseFormat"`
	MovieRelease  string `json:"movieReleaseName"`
}

func fetchOpenSubtitlesWithTimeout(ctx context.Context, base, kind, id string, season, episode int, imdbID string, timeout time.Duration) ([]subtitleTrack, string) {
	subCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return fetchOpenSubtitles(subCtx, base, kind, id, season, episode, imdbID)
}

func fetchOpenSubtitles(ctx context.Context, base, kind, id string, season, episode int, imdbID string) ([]subtitleTrack, string) {
	imdb := strings.TrimSpace(imdbID)
	if imdb == "" && id != "" {
		imdb, _ = imdbFor(ctx, kind, id)
	}
	if !strings.HasPrefix(imdb, "tt") {
		return nil, imdb
	}

	var endpoint string
	if kind == "tv" {
		endpoint = fmt.Sprintf("%s/subtitles/series/%s:%d:%d.json", strings.TrimRight(openSubtitlesBaseURL, "/"), url.PathEscape(imdb), season, episode)
	} else {
		endpoint = fmt.Sprintf("%s/subtitles/movie/%s.json", strings.TrimRight(openSubtitlesBaseURL, "/"), url.PathEscape(imdb))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, imdb
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json")

	resp, err := textClient.Do(req)
	if err != nil {
		return nil, imdb
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, imdb
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, imdb
	}
	var parsed struct {
		Subtitles []openSubItem `json:"subtitles"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Subtitles) == 0 {
		return nil, imdb
	}

	// Score items so cleaner non-CAM/TS releases come first for each language.
	scored := make([]openSubItem, len(parsed.Subtitles))
	copy(scored, parsed.Subtitles)
	scoreItem := func(it openSubItem) int {
		lower := strings.ToLower(it.ReleaseFormat + " " + it.FileName + " " + it.MovieRelease)
		score := 0
		if strings.Contains(lower, "web") || strings.Contains(lower, "bluray") || strings.Contains(lower, "blu-ray") || strings.Contains(lower, "hdrip") || strings.Contains(lower, "hdtv") {
			score += 3
		}
		if strings.Contains(lower, "cam") || strings.Contains(lower, "telesync") || strings.Contains(lower, "hdts") || strings.Contains(lower, ".ts.") {
			score -= 3
		}
		if !strings.Contains(lower, ".hi.") {
			score += 1
		}
		return score
	}
	sort.SliceStable(scored, func(i, j int) bool {
		return scoreItem(scored[i]) > scoreItem(scored[j])
	})

	perLang := map[string]int{}
	out := make([]subtitleTrack, 0, 24)
	for _, it := range scored {
		if !isHTTPURL(it.URL) {
			continue
		}
		code, baseName := normalizeSubtitleLang(it.Lang, "")
		if perLang[code] >= 2 {
			continue
		}
		perLang[code]++
		label := baseName
		if strings.Contains(strings.ToLower(it.FileName), ".hi.") {
			label += " (CC)"
		}
		track, ok := registerSubtitle(base, it.URL, code, label, "opensubtitles", "", "")
		if ok {
			out = append(out, track)
		}
		if len(out) >= 24 {
			break
		}
	}
	return finalizeSubtitles(out), imdb
}

func handleMovieSubtitles(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTMDB(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_tmdb_id", "The TMDB id must be a positive integer.")
		return
	}
	imdbOverride := strings.TrimSpace(r.URL.Query().Get("imdb_id"))
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	base := baseOf(r)
	idStr := strconv.Itoa(id)
	cached, cachedImdb := cachedTitleSubtitlesFor(base, "movie", idStr, 0, 0)
	if imdbOverride == "" {
		imdbOverride = cachedImdb
	}
	openSubs, imdbID := fetchOpenSubtitles(ctx, base, "movie", idStr, 0, 0, imdbOverride)
	merged := finalizeSubtitles(append(cached, openSubs...))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"type":      "movie",
		"tmdb_id":   id,
		"imdb_id":   imdbID,
		"subtitles": merged,
	})
}

func handleEpisodeSubtitles(w http.ResponseWriter, r *http.Request) {
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
	imdbOverride := strings.TrimSpace(r.URL.Query().Get("imdb_id"))
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	base := baseOf(r)
	idStr := strconv.Itoa(id)
	cached, cachedImdb := cachedTitleSubtitlesFor(base, "tv", idStr, season, episode)
	if imdbOverride == "" {
		imdbOverride = cachedImdb
	}
	openSubs, imdbID := fetchOpenSubtitles(ctx, base, "tv", idStr, season, episode, imdbOverride)
	merged := finalizeSubtitles(append(cached, openSubs...))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"type":      "tv",
		"tmdb_id":   id,
		"season":    season,
		"episode":   episode,
		"imdb_id":   imdbID,
		"subtitles": merged,
	})
}

func handleSubtitleProxy(w http.ResponseWriter, r *http.Request) {
	rawID := strings.TrimSpace(r.PathValue("id"))
	if strings.HasSuffix(rawID, ".m3u8") {
		token := strings.TrimSuffix(rawID, ".m3u8")
		if _, ok := subtitlesStore.get(token); !ok {
			writeError(w, http.StatusNotFound, "subtitle_not_found", "This subtitle link has expired or does not exist.")
			return
		}
		vttURL := baseOf(r) + "/v1/subtitle/" + token + ".vtt?hls=1"
		playlist := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:18000\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:18000.000,\n" + vttURL + "\n#EXT-X-ENDLIST\n"
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "private, max-age=1800")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(playlist))
		return
	}

	token := strings.TrimSuffix(rawID, ".vtt")
	entry, ok := subtitlesStore.get(token)
	if !ok {
		writeError(w, http.StatusNotFound, "subtitle_not_found", "This subtitle link has expired or does not exist.")
		return
	}

	wantsHLS := r.URL.Query().Get("hls") == "1"

	var vtt []byte
	subBodyCache.mu.Lock()
	if hit, ok := subBodyCache.m[token]; ok && time.Since(hit.at) < subBodyTTL {
		vtt = hit.vtt
	}
	subBodyCache.mu.Unlock()

	if len(vtt) == 0 {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, entry.url, nil)
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "Invalid upstream subtitle request.")
			return
		}
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Accept", "text/vtt, text/plain, application/x-subrip, */*")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		if entry.referer != "" {
			req.Header.Set("Referer", entry.referer)
		} else if isSource2URL(entry.url) {
			req.Header.Set("Referer", source2Player+"/")
		}
		if entry.origin != "" {
			req.Header.Set("Origin", entry.origin)
		} else if isSource2URL(entry.url) {
			req.Header.Set("Origin", source2Player)
		}

		resp, err := textClient.Do(req)
		if err != nil {
			logUpstream("subtitle", entry.url, err)
			writeError(w, http.StatusBadGateway, "upstream_error", "Could not reach the subtitle source.")
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			writeError(w, http.StatusBadGateway, "upstream_error", "The subtitle source returned an error.")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "Could not read the subtitle file.")
			return
		}
		vtt = srtToVTT(raw)
		if len(vtt) < 512<<10 {
			subBodyCache.mu.Lock()
			if len(subBodyCache.m) >= maxSubBodyCache {
				cutoff := time.Now().Add(-subBodyTTL)
				for k, v := range subBodyCache.m {
					if v.at.Before(cutoff) {
						delete(subBodyCache.m, k)
					}
				}
				if len(subBodyCache.m) >= maxSubBodyCache {
					subBodyCache.m = map[string]subBodyEntry{}
				}
			}
			subBodyCache.m[token] = subBodyEntry{vtt: vtt, at: time.Now()}
			subBodyCache.mu.Unlock()
		}
	}

	out := vtt
	if wantsHLS {
		out = withHLSTimestampMap(vtt)
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=1800")
	w.WriteHeader(http.StatusOK)
	w.Write(out)
}

var (
	srtTimingLine = regexp.MustCompile(`^\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}.*$`)
	srtCommaTime  = regexp.MustCompile(`(\d{1,2}:\d{2}:\d{2}|\d{2}:\d{2}),(\d{1,3})`)
	assTagStrip   = regexp.MustCompile(`\{\\[^}]*\}`)
	digitsOnly    = regexp.MustCompile(`^\d+$`)
)

func decodeLatin1IfNeeded(raw []byte) string {
	if utf8.Valid(raw) {
		return string(raw)
	}
	runes := make([]rune, len(raw))
	for i, b := range raw {
		runes[i] = rune(b)
	}
	return string(runes)
}

func padCueTimestamp(ts string) string {
	// Ensure trailing comma->dot and normalize ms to 3 digits if needed, keeping short mm:ss.mmm or hh:mm:ss.mmm valid.
	ts = srtCommaTime.ReplaceAllString(ts, "$1.$2")
	return ts
}

func srtToVTT(raw []byte) []byte {
	s := decodeLatin1IfNeeded(raw)
	s = strings.TrimPrefix(s, "\uFEFF")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.TrimLeft(s, "\n\t ")

	if strings.HasPrefix(strings.ToUpper(s), "WEBVTT") {
		if !strings.HasSuffix(s, "\n") {
			s += "\n"
		}
		return []byte(s)
	}

	lines := strings.Split(s, "\n")
	var b strings.Builder
	b.Grow(len(s) + 32)
	b.WriteString("WEBVTT\n\n")

	inCue := false
	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], " \t")
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			if inCue {
				b.WriteByte('\n')
				inCue = false
			}
			continue
		}

		// Skip SRT sequence numbers that immediately precede a timing line.
		if !inCue && digitsOnly.MatchString(trimmed) && i+1 < len(lines) && srtTimingLine.MatchString(lines[i+1]) {
			continue
		}

		if srtTimingLine.MatchString(trimmed) {
			if inCue {
				b.WriteByte('\n')
			}
			arrowIdx := strings.Index(trimmed, "-->")
			startPart := padCueTimestamp(strings.TrimSpace(trimmed[:arrowIdx]))
			restPart := strings.TrimSpace(trimmed[arrowIdx+3:])
			b.WriteString(startPart)
			b.WriteString(" --> ")
			b.WriteString(padCueTimestamp(restPart))
			b.WriteByte('\n')
			inCue = true
			continue
		}

		if inCue {
			clean := assTagStrip.ReplaceAllString(line, "")
			b.WriteString(clean)
			b.WriteByte('\n')
		}
	}
	if inCue {
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

func withHLSTimestampMap(vtt []byte) []byte {
	s := string(vtt)
	if strings.Contains(strings.ToUpper(s), "X-TIMESTAMP-MAP=") {
		return vtt
	}
	idx := strings.IndexByte(s, '\n')
	if idx < 0 {
		return vtt
	}
	header := s[:idx]
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(header)), "WEBVTT") {
		return vtt
	}
	return []byte(header + "\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0" + s[idx:])
}
