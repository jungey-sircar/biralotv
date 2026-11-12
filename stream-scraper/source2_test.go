package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSource2DecryptVector(t *testing.T) {
	const pk = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
	const cipher = "EBESExQVFhcYGRobHB0eH4MsRRtqQRGvWi9ijqGHbCIBUBIDr37sX3ng-BvAiwro6kCZUrjcPhNrpjLWvuc"
	got, err := source2Decrypt(cipher, pk)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"ok":true,"url":"https://cdn.example/x.m3u8"}` {
		t.Fatalf("unexpected plaintext: %s", got)
	}
}

func TestParseSource2Config(t *testing.T) {
	config := `window.__EM_PLAYER__ = {"ticket":"ticket","pk":"00","scrapeToken":"scrape","feedUrl":"https://feed/","feedUrlBackup":"","resolveUrl":"/resolve.php"};`
	key := []byte{1, 2, 3, 4}
	base := 9
	xored := make([]byte, len(config))
	for i := range []byte(config) {
		xored[i] = config[i] ^ byte((base+int(key[i%len(key)])+i)&0xff)
	}
	blob := base64.StdEncoding.EncodeToString(xored)
	page := []byte(`<script>var _abc="` + blob + `",_def=[1,2,3,4],_ghi=9;</script>`)
	cfg, err := parseSource2Config(page)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Ticket != "ticket" || cfg.ScrapeToken != "scrape" || cfg.ResolveURL != "/resolve.php" {
		b, _ := json.Marshal(cfg)
		t.Fatalf("unexpected config: %s", b)
	}
}

func TestSource2ServerType(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int
	}{
		{`{"source_type":85}`, 85},
		{`{"source_type":"80"}`, 80},
	} {
		var server source2Server
		if err := json.NewDecoder(strings.NewReader(tc.raw)).Decode(&server); err != nil {
			t.Fatal(err)
		}
		if got := server.typeID(); got != tc.want {
			t.Fatalf("typeID(%s)=%d, want %d", tc.raw, got, tc.want)
		}
	}
}

func TestSource2CandidatesOrder(t *testing.T) {
	servers := []source2Server{
		{SourceType: json.RawMessage(`34`), SourceURL: "abyss"},
		{SourceType: json.RawMessage(`80`), SourceURL: "joy"},
		{SourceType: json.RawMessage(`85`), SourceURL: "4u"},
	}
	got := source2Candidates(servers)
	if len(got) != 2 || got[0].SourceURL != "4u" || got[1].SourceURL != "joy" {
		t.Fatalf("unexpected order: %+v", got)
	}
}

func TestSource3CandidatesSecondaryOnly(t *testing.T) {
	servers := []source2Server{
		{SourceType: json.RawMessage(`85`), SourceURL: "4u"},
		{SourceType: json.RawMessage(`80`), SourceURL: "joy"},
		{SourceType: json.RawMessage(`34`), SourceURL: "abyss"},
	}
	got := chooseCandidates(servers, []int{source2Secondary})
	if len(got) != 1 || got[0].SourceURL != "joy" {
		t.Fatalf("source3 must only take the secondary catalog, got %+v", got)
	}
	if len(chooseCandidates(servers[:1], []int{source2Secondary})) != 0 {
		t.Fatal("source3 must not fall back to the primary catalog")
	}
}

func TestServersEndpoint(t *testing.T) {
	rec := httptest.NewRecorder()
	newRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/servers", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"server1"`) || !strings.Contains(rec.Body.String(), `"server3"`) {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestInvalidRequests(t *testing.T) {
	for _, path := range []string{
		"/v1/movies/not-a-number",
		"/v1/movies/0",
		"/v1/movies/603?server=server4",
		"/v1/shows/1399/seasons/0/episodes/1?server=server1",
	} {
		rec := httptest.NewRecorder()
		newRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, body = %s", path, rec.Code, rec.Body.String())
		}
	}
}
