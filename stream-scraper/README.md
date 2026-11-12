# stream-scraper

A small standalone Go service that resolves movie and TV stream links from three interchangeable server modules.

| Alias | Behaviour |
| --- | --- |
| `server1` | Default. Tries the requested mirror first, then up to three alternates. |
| `server2` | Primary catalog first, secondary catalog as fallback. |
| `server3` | Secondary catalog only. No fallback to the primary catalog. |

It returns HLS playlists and quality variants, and keeps the upstream provider URLs behind a local stream proxy so the player only talks to this service.

This folder is self contained. It does not contain a frontend, TLS handshake, encrypted responses, cookies, database layer, geo gate, subtitles, or live TV.

A full API reference with request and response examples is in [`documentation.html`](documentation.html).

## Requirements

- Go 1.25 or newer
- Network access to the upstream provider hosts

## Quick start

```bash
cd stream-scraper
go mod download
go run .
```

The service starts on port `8080`:

```bash
curl http://localhost:8080/healthz
```

Build a single binary:

```bash
go build -o stream-scraper .
./stream-scraper
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | empty | Optional bind address, e.g. `127.0.0.1` for loopback-only access. |
| `PORT` | `8080` | HTTP listen port. |
| `PUBLIC_BASE_URL` | request host | Public base URL used in returned stream links. Set this when running behind a reverse proxy, for example `https://scraper.example.com`. |
| `SCRAPER_UPSTREAM_PROXY` | empty | Optional HTTP or SOCKS5 proxy for provider requests, for example `socks5://127.0.0.1:1080`. |
| `SCRAPER_UPSTREAM_PROXY_HOSTS` | empty | Comma separated host suffixes that use the proxy, for example `api.example.com,media.example.com`. Empty means every request uses the proxy when one is configured. |

The upstream proxy is useful when a VPS is blocked by a provider. Media segments that do not match the host list still go direct.

```bash
PORT=9000 \
PUBLIC_BASE_URL=https://scraper.example.com \
SCRAPER_UPSTREAM_PROXY=socks5://127.0.0.1:1080 \
SCRAPER_UPSTREAM_PROXY_HOSTS=api.example.com,media.example.com \
./stream-scraper
```

## API

All responses are JSON. Errors use normal HTTP status codes. Full details and more examples are in [`documentation.html`](documentation.html).

### `GET /healthz`

```json
{"status":"ok","uptime_s":12,"version":"1.0.0"}
```

### `GET /v1/servers`

Lists the three aliases.

```bash
curl http://localhost:8080/v1/servers
```

```json
{
  "servers": [
    {"id": "server1", "note": "Default. Optional mirror query parameter."},
    {"id": "server2", "note": "Primary catalog first, secondary catalog fallback."},
    {"id": "server3", "note": "Secondary catalog only. No fallback."}
  ]
}
```

### `GET /v1/catalog/movies`

Lists movies (`list=latest|now_playing|trending|popular|top_rated|upcoming`, `page=1`) or searches by title (`q=`).

```bash
curl 'http://localhost:8080/v1/catalog/movies?list=latest&page=1'
curl 'http://localhost:8080/v1/catalog/movies?q=metropolis'
curl 'http://localhost:8080/v1/catalog/movies/19'
```

### `GET /v1/movies/{tmdb_id}`

Query parameters:

| Name | Values | Default | Meaning |
| --- | --- | --- | --- |
| `server` | `server1`, `server2`, `server3` | `server1` | Which server module to use. |
| `mirror` | `miami`, `delhi`, `berlin`, `paris`, `munich`, and other mirror names | `miami` | `server1` only. The first mirror to try. |

```bash
curl 'http://localhost:8080/v1/movies/19?server=server1'
curl 'http://localhost:8080/v1/movies/19?server=server2'
curl 'http://localhost:8080/v1/movies/19?server=server3'
curl 'http://localhost:8080/v1/movies/19?server=server1&mirror=delhi'
```

`19` is the TMDB id for Metropolis (1927). Any numeric TMDB movie id works.

Example response:

```json
{
  "type": "movie",
  "tmdb_id": 19,
  "server": "server1",
  "resolved_by": "miami",
  "playlist": "http://localhost:8080/v1/stream/14559efd36019650cc",
  "streams": [
    {
      "quality": "1080p",
      "url": "http://localhost:8080/v1/stream/5c6713ba322eeead58"
    },
    {
      "quality": "720p",
      "url": "http://localhost:8080/v1/stream/3463894611299b9d10"
    }
  ]
}
```

Fields:

- `playlist`: master HLS playlist. Use this unless you have a reason to pick a specific variant.
- `streams`: quality variants, already routed through the stream proxy.
- `resolved_by`: the `server1` mirror, or `primary` / `secondary` for `server2` and `server3`.
- `thumbnails`: optional proxied thumbnail URL.

### `GET /v1/shows/{tmdb_id}/seasons/{season}/episodes/{episode}`

Same query parameters as the movie endpoint.

```bash
curl 'http://localhost:8080/v1/shows/1399/seasons/1/episodes/1?server=server1'
curl 'http://localhost:8080/v1/shows/1399/seasons/1/episodes/1?server=server2'
curl 'http://localhost:8080/v1/shows/1399/seasons/1/episodes/1?server=server3'
```

Season must be at least `1`. Episode may be `0` for providers that use zero based specials.

```json
{
  "type": "tv",
  "tmdb_id": 1399,
  "season": 1,
  "episode": 1,
  "server": "server3",
  "resolved_by": "secondary",
  "playlist": "http://localhost:8080/v1/stream/...",
  "streams": [
    {
      "quality": "FULL HD",
      "url": "http://localhost:8080/v1/stream/..."
    }
  ]
}
```

### `GET /v1/stream/{token}`

Internal playback proxy. The links are generated in API responses and are not meant to be constructed by hand.

The proxy:

- Adds the provider referer and origin headers.
- Forwards range requests, so seeking works.
- Rewrites HLS playlists, variants, keys, init maps and segments back through itself.
- Keeps the real upstream URLs server side.

Tokens are deterministic for a media path, so a playlist reload maps the same segment to the same proxy URL.

## Playback example

Use the `playlist` field directly with hls.js:

```js
const info = await fetch("http://localhost:8080/v1/movies/19?server=server2").then(r => r.json());

const video = document.querySelector("video");
const hls = new Hls();
hls.loadSource(info.playlist);
hls.attachMedia(video);
```

The proxy sends permissive CORS headers, so the browser can load playlists and segments from a different origin.

VLC:

```bash
vlc "http://localhost:8080/v1/stream/14559efd36019650cc"
```

The token above is an example. Use the URL returned for the current request.

## Error responses

```json
{
  "error": {
    "code": "no_streams",
    "message": "No stream was found for this title on the requested server."
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_tmdb_id` | The id is not a positive integer. |
| `400` | `invalid_server` | Use `server1`, `server2` or `server3`. |
| `400` | `invalid_episode` | Season is zero, or season/episode is not numeric. |
| `404` | `no_streams` | The provider has no source for this title. |
| `404` | `stream_not_found` | The proxy token expired or never existed. |
| `502` | `upstream_error` | A provider or CDN returned an error. |
| `504` | `upstream_timeout` | A provider did not answer in time. |

## How each server works

### server1

1. Ask the upstream API for a short lived seed for the TMDB id.
2. Look up the IMDb id when the provider needs it.
3. Request the sources endpoint for the selected mirror.
4. Decrypt the provider payload with the seed.
5. If the mirror has no source, try up to three alternate mirrors.
6. Store the returned HLS URLs behind `/v1/stream/{token}`.

### server2

1. Open the catalog movie or episode page.
2. Spend the page ticket and extract the embedded player config.
3. Fetch the NDJSON server list.
4. Prefer the primary catalog, then the secondary catalog.
5. Resolve the encrypted source URL and store the HLS URL behind the proxy.

### server3

Same flow as `server2`, but only secondary catalog entries are considered. If the secondary catalog has no source, the request returns `no_streams`. It never falls back to the primary catalog.

## Tests

```bash
cd stream-scraper
go test ./...
go vet ./...
```

The tests cover:

- Source alias mapping, including the default `server1`.
- TMDB id and episode validation.
- `server1` mirror ordering.
- Catalog config decoding and primary / secondary candidate order.
- `server3` secondary-only rule.
- Stable proxy tokens across rotating query strings.
- HLS playlist rewriting and segment forwarding with range support.
- Upstream proxy host scoping.
- Basic HTTP routes and invalid request handling.

A live smoke test uses `tmdb_id=19`:

```bash
PORT=8300 PUBLIC_BASE_URL=http://127.0.0.1:8300 go run .
curl 'http://127.0.0.1:8300/v1/movies/19?server=server1'
curl 'http://127.0.0.1:8300/v1/movies/19?server=server2'
curl 'http://127.0.0.1:8300/v1/movies/19?server=server3'
```

## File map

```text
stream-scraper/
  main.go            process startup and graceful shutdown
  server.go          routes, server aliases, JSON responses
  catalog.go         movie catalog & search proxy endpoints
  source1.go         seed, sources, mirror fallback
  source2.go         catalog scraper for server2
  source3.go         catalog scraper for server3
  decrypt.go         provider payload decryption (goja)
  upstream.go        HTTP clients and optional upstream proxy
  stream.go          token store, HLS rewriting, playback proxy
  types.go           shared request and response types
  *_test.go          offline unit and integration tests
  documentation.html full API reference
  README.md
```

## Operational notes

- Stream tokens live in memory for four hours. A restart invalidates every token.
- The token store is process local. Run one instance, or use sticky routing if you run several.
- Provider URLs can expire before the token TTL. Fetch a fresh API response when a stream stops playing.
- Provider sites change without notice. If a source starts failing, its page config or API shape probably changed.
- The upstream proxy variables are the first thing to try when only one server module fails on a VPS.
