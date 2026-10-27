package models

import "time"

type Channel struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Logo    string    `json:"logo,omitempty"`
	Stream  string    `json:"stream,omitempty"`
	Source  string    `json:"source"`
	Group   string    `json:"group,omitempty"`
	Number  string    `json:"number,omitempty"` // mapple numeric id used for stream resolution
	Updated time.Time `json:"updated"`
}

type Playlist struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url,omitempty"`
	ChannelCt int       `json:"channel_count"`
	CreatedAt time.Time `json:"created_at"`
}

type ScrapeStatus struct {
	Running bool      `json:"running"`
	Source  string    `json:"source,omitempty"`
	Done    int64     `json:"done"`
	Total   int64     `json:"total"`
	Failed  int64     `json:"failed"`
	Started time.Time `json:"started,omitempty"`
	LastOK  time.Time `json:"last_success,omitempty"`
}

type Page struct {
	Channels   []Channel `json:"channels"`
	Page       int       `json:"page"`
	PerPage    int       `json:"per_page"`
	Total      int       `json:"total"`
	TotalPages int       `json:"total_pages"`
}
