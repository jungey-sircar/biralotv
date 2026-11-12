package main

// Shared scraper types.

type streamVariant struct {
	Quality string `json:"quality"`
	URL     string `json:"url"`
}

type subtitleTrack struct {
	ID       string `json:"id"`
	Language string `json:"language"`
	Label    string `json:"label"`
	Format   string `json:"format"`
	URL      string `json:"url"`
	Source   string `json:"source,omitempty"`
}

// resolvedMedia is what a provider returns internally. The public response adds
// the numeric TMDB id and the public server alias.
type resolvedMedia struct {
	Type       string
	Season     int
	Episode    int
	ResolvedBy string
	Playlist   string
	Streams    []streamVariant
	Thumbnails string
	Subtitles  []subtitleTrack
}

type streamResponse struct {
	Type       string          `json:"type"`
	TMDBID     int             `json:"tmdb_id"`
	Season     int             `json:"season,omitempty"`
	Episode    int             `json:"episode,omitempty"`
	Server     string          `json:"server"`
	ResolvedBy string          `json:"resolved_by,omitempty"`
	Playlist   string          `json:"playlist,omitempty"`
	Streams    []streamVariant `json:"streams"`
	Thumbnails string          `json:"thumbnails,omitempty"`
	Subtitles  []subtitleTrack `json:"subtitles"`
}
