package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetSubtitleState() {
	subtitlesStore = &subTokenStore{entries: map[string]subtitleEntry{}}
	subBodyCache.mu.Lock()
	subBodyCache.m = map[string]subBodyEntry{}
	subBodyCache.mu.Unlock()
	titleSubsCache.mu.Lock()
	titleSubsCache.m = map[string]titleSubsEntry{}
	titleSubsCache.mu.Unlock()
}

func TestSRTToVTTConversion(t *testing.T) {
	srt := "\xEF\xBB\xBF1\r\n00:01:23,183 --> 00:01:24,418\r\n{\\an8}Well, you know, I mean,\r\n\r\n2\r\n00:01:24,451 --> 00:01:27,287\r\nLine one\r\nLine two\r\n"
	got := string(srtToVTT([]byte(srt)))
	if !strings.HasPrefix(got, "WEBVTT\n\n") {
		t.Fatalf("missing WEBVTT header: %q", got)
	}
	if !strings.Contains(got, "00:01:23.183 --> 00:01:24.418\nWell, you know, I mean,\n") {
		t.Fatalf("did not normalize cue 1: %q", got)
	}
	if strings.Contains(got, "{\\an8}") || strings.Contains(got, "\r") {
		t.Fatalf("did not strip ASS tag / CR: %q", got)
	}
	if !strings.Contains(got, "00:01:24.451 --> 00:01:27.287\nLine one\nLine two\n") {
		t.Fatalf("did not normalize multiline cue 2: %q", got)
	}

	// Valid WebVTT with MM:SS.mmm should stay intact.
	vtt := "WEBVTT\n\n01:23.208 --> 01:24.458\nShort timestamps\n"
	gotVTT := string(srtToVTT([]byte(vtt)))
	if !strings.Contains(gotVTT, "01:23.208 --> 01:24.458\nShort timestamps") {
		t.Fatalf("altered valid WebVTT: %q", gotVTT)
	}

	// Latin-1 byte fallback (0xE9 = e-acute).
	latin1 := append([]byte("1\n00:00:01,000 --> 00:00:02,000\nCaf"), 0xE9, '\n')
	gotLatin := string(srtToVTT(latin1))
	if !strings.Contains(gotLatin, "Café") {
		t.Fatalf("did not decode Latin-1: %q", gotLatin)
	}
}

func TestWithHLSTimestampMap(t *testing.T) {
	in := []byte("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n")
	out := string(withHLSTimestampMap(in))
	if !strings.HasPrefix(out, "WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n") {
		t.Fatalf("unexpected HLS WebVTT: %q", out)
	}
	// Idempotent when already present.
	out2 := string(withHLSTimestampMap([]byte(out)))
	if out2 != out {
		t.Fatalf("duplicated X-TIMESTAMP-MAP: %q", out2)
	}
}

func TestFinalizeSubtitlesSortingAndLabels(t *testing.T) {
	resetSubtitleState()
	t1, _ := registerSubtitle("http://p.test", "https://a.test/spa.vtt", "spa", "", "server1", "", "")
	t2, _ := registerSubtitle("http://p.test", "https://a.test/en1.vtt", "eng", "", "opensubtitles", "", "")
	t3, _ := registerSubtitle("http://p.test", "https://a.test/en2.vtt", "eng", "", "server1", "", "")
	t4, _ := registerSubtitle("http://p.test", "https://a.test/en3.vtt", "eng (2)", "eng (2)", "server1", "", "")
	t5, _ := registerSubtitle("http://p.test", "https://a.test/und.vtt", "", "", "server2", "", "")

	got := finalizeSubtitles([]subtitleTrack{t1, t2, t3, t4, t5})
	if len(got) != 5 {
		t.Fatalf("got %d tracks, want 5", len(got))
	}
	if got[0].Language != "en" || got[0].Source != "server1" || got[0].Label != "English" {
		t.Fatalf("expected built-in English first, got %+v", got[0])
	}
	if got[1].Language != "en" || got[1].Label != "English (2)" {
		t.Fatalf("expected built-in second English next, got %+v", got[1])
	}
	if got[2].Language != "es" {
		t.Fatalf("expected Spanish next, got %+v", got[2])
	}
	if got[3].Language != "und" {
		t.Fatalf("expected non-empty und language code, got %+v", got[3])
	}
	if got[4].Source != "opensubtitles" || got[4].Label != "English (3)" {
		t.Fatalf("expected OpenSubtitles last with unique label, got %+v", got[4])
	}
}

func TestSubtitleProxySRTM3U8AndReferer(t *testing.T) {
	resetSubtitleState()
	var gotReferer string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReferer = r.Header.Get("Referer")
		fmt.Fprint(w, "1\n00:00:02,000 --> 00:00:04,000\nHello world\n")
	}))
	defer upstream.Close()

	track, ok := registerSubtitle("http://proxy.test", upstream.URL+"/sub.srt", "eng", "English", "opensubtitles", "", "")
	if !ok {
		t.Fatal("registerSubtitle failed")
	}

	router := newRouter()

	// Fetch normalized .vtt
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/subtitle/"+track.ID+".vtt", nil)
	req.Host = "proxy.test"
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("vtt status = %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/vtt") {
		t.Fatalf("unexpected content-type = %q", ct)
	}
	if gotReferer != "" {
		t.Fatalf("expected empty Referer for opensubtitles, got %q", gotReferer)
	}
	if !strings.Contains(rec.Body.String(), "00:00:02.000 --> 00:00:04.000\nHello world") {
		t.Fatalf("unexpected converted vtt: %q", rec.Body.String())
	}

	// Fetch .vtt?hls=1
	recHLS := httptest.NewRecorder()
	reqHLS := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/subtitle/"+track.ID+".vtt?hls=1", nil)
	reqHLS.Host = "proxy.test"
	router.ServeHTTP(recHLS, reqHLS)
	if !strings.Contains(recHLS.Body.String(), "X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0") {
		t.Fatalf("missing X-TIMESTAMP-MAP: %q", recHLS.Body.String())
	}

	// Fetch HLS subtitle .m3u8 wrapper
	recM3U := httptest.NewRecorder()
	reqM3U := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/subtitle/"+track.ID+".m3u8", nil)
	reqM3U.Host = "proxy.test"
	router.ServeHTTP(recM3U, reqM3U)
	if recM3U.Code != http.StatusOK {
		t.Fatalf("m3u8 status = %d", recM3U.Code)
	}
	if ct := recM3U.Header().Get("Content-Type"); !strings.Contains(ct, "mpegurl") {
		t.Fatalf("unexpected m3u8 content-type = %q", ct)
	}
	if !strings.Contains(recM3U.Body.String(), "http://proxy.test/v1/subtitle/"+track.ID+".vtt?hls=1") {
		t.Fatalf("unexpected subtitle m3u8 body: %q", recM3U.Body.String())
	}

	// Unknown token returns 404
	rec404 := httptest.NewRecorder()
	router.ServeHTTP(rec404, httptest.NewRequest(http.MethodGet, "/v1/subtitle/missing.vtt", nil))
	if rec404.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", rec404.Code)
	}
}

func TestRewritePlaylistWithSubtitles(t *testing.T) {
	resetStreams()
	resetSubtitleState()
	subs := []subtitleTrack{
		{ID: "sub111", Language: "en", Label: `English "CC"`, Format: "vtt"},
		{ID: "sub222", Language: "", Label: "Unknown", Format: "vtt"},
	}

	master := "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720\nhttps://cdn.example.test/720p.m3u8\n"
	out := string(rewritePlaylistWithSubtitles("http://proxy.test", []byte(master), "https://cdn.example.test/master.m3u8", subs))
	if !strings.Contains(out, `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="biralosubs",NAME="English 'CC'",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="http://proxy.test/v1/subtitle/sub111.m3u8"`) {
		t.Fatalf("missing injected English media tag:\n%s", out)
	}
	if !strings.Contains(out, `LANGUAGE="und"`) {
		t.Fatalf("empty language must default to und:\n%s", out)
	}
	if !strings.Contains(out, `,SUBTITLES="biralosubs"`) {
		t.Fatalf("missing SUBTITLES group attribute on STREAM-INF:\n%s", out)
	}

	// Media playlists must NOT get #EXT-X-MEDIA injected.
	media := "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nhttps://cdn.example.test/seg0.m4s\n#EXT-X-ENDLIST\n"
	outMedia := string(rewritePlaylistWithSubtitles("http://proxy.test", []byte(media), "https://cdn.example.test/720p.m3u8", subs))
	if strings.Contains(outMedia, "TYPE=SUBTITLES") {
		t.Fatalf("media playlist should not contain TYPE=SUBTITLES:\n%s", outMedia)
	}
}

func TestSubtitlesMovieAndEpisodeEndpoints(t *testing.T) {
	resetSubtitleState()
	prevOS := openSubtitlesBaseURL
	defer func() { openSubtitlesBaseURL = prevOS }()

	mockOS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/subtitles/movie/tt9000001.json":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"subtitles": []map[string]string{
					{"id": "1", "url": "https://subs.example.test/cam.srt", "lang": "eng", "releaseFormat": "Cam", "subtitleFileName": "Movie.CAM.srt"},
					{"id": "2", "url": "https://subs.example.test/web.srt", "lang": "eng", "releaseFormat": "WEB-DL", "subtitleFileName": "Movie.WEB-DL.srt"},
					{"id": "3", "url": "https://subs.example.test/spa.srt", "lang": "spa", "releaseFormat": "BluRay", "subtitleFileName": "Movie.SPA.srt"},
				},
			})
		case "/subtitles/series/tt9000002:1:2.json":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"subtitles": []map[string]string{
					{"id": "4", "url": "https://subs.example.test/s01e02.srt", "lang": "eng", "releaseFormat": "WEB-DL", "subtitleFileName": "Show.S01E02.srt"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockOS.Close()
	openSubtitlesBaseURL = mockOS.URL

	imdbCache.Store("movie:9000001", "tt9000001")
	imdbCache.Store("tv:9000002", "tt9000002")

	// Pre-populate cached upstream subtitle so merge keeps built-in first.
	builtin, _ := registerSubtitle("http://old.test", "https://cdn.example.test/eng.vtt", "eng", "English", "server1", "https://www.vidy.st/", "https://www.vidy.st")
	rememberTitleSubtitles("movie", "9000001", 0, 0, "tt9000001", []subtitleTrack{builtin})

	router := newRouter()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/subtitles/movies/9000001", nil)
	req.Host = "proxy.test"
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("movie subtitles status = %d: %s", rec.Code, rec.Body.String())
	}
	var movieBody struct {
		Type      string          `json:"type"`
		TMDBID    int             `json:"tmdb_id"`
		IMDbID    string          `json:"imdb_id"`
		Subtitles []subtitleTrack `json:"subtitles"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &movieBody); err != nil {
		t.Fatal(err)
	}
	if len(movieBody.Subtitles) < 3 {
		t.Fatalf("expected merged built-in + opensubtitles, got %+v", movieBody.Subtitles)
	}
	if movieBody.Subtitles[0].Source != "server1" {
		t.Fatalf("built-in track should come before opensubtitles: %+v", movieBody.Subtitles[0])
	}
	if !strings.HasPrefix(movieBody.Subtitles[0].URL, "http://proxy.test/v1/subtitle/") {
		t.Fatalf("subtitle URL should use request host base: %s", movieBody.Subtitles[0].URL)
	}

	// Episode subtitles endpoint.
	recTV := httptest.NewRecorder()
	reqTV := httptest.NewRequest(http.MethodGet, "http://proxy.test/v1/subtitles/shows/9000002/seasons/1/episodes/2", nil)
	reqTV.Host = "proxy.test"
	router.ServeHTTP(recTV, reqTV)
	if recTV.Code != http.StatusOK || !strings.Contains(recTV.Body.String(), `"language":"en"`) {
		t.Fatalf("episode subtitles unexpected: %d %s", recTV.Code, recTV.Body.String())
	}
}
