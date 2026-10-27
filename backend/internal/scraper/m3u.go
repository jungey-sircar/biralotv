package scraper

import (
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
)

// EXTINF := #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Display Name
type M3UEntry struct {
	Name  string
	Logo  string
	Group string
	URL   string
	Attrs map[string]string
}

var attrNameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789_"

func ParseM3U(text string) []M3UEntry {
	var out []M3UEntry
	var cur *M3UEntry
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 0, 1024*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "#EXTINF:"):
			if cur != nil && cur.URL != "" {
				out = append(out, *cur)
				cur = nil
			}
			entry := M3UEntry{Attrs: map[string]string{}}
			rest := line[len("#EXTINF:"):]
			// display name is after the first comma that follows the duration/attrs
			comma := strings.Index(rest, ",")
			title := ""
			attrPart := rest
			if comma >= 0 {
				attrPart = rest[:comma]
				title = strings.TrimSpace(rest[comma+1:])
			}
			entry.Name = title
			entry.Attrs = parseAttrsSingleQuoteCompatible(attrPart)
			if entry.Attrs["tvg-name"] != "" && entry.Name == "" {
				entry.Name = entry.Attrs["tvg-name"]
			}
			entry.Logo = entry.Attrs["tvg-logo"]
			entry.Group = entry.Attrs["group-title"]
			cur = &entry
		case strings.HasPrefix(line, "#"):
			// other directives (EXTGRP, EXTVLCOPT...) ignored
			continue
		default:
			if cur != nil {
				cur.URL = line
				out = append(out, *cur)
				cur = nil
			}
		}
	}
	if cur != nil && cur.URL != "" {
		out = append(out, *cur)
	}
	return out
}

// parseAttrsSingleQuoteCompatible parses `attr="value" attr2='value2'` style lists.
func parseAttrsSingleQuoteCompatible(s string) map[string]string {
	m := map[string]string{}
	i := 0
	n := len(s)
	for i < n {
		start := i
		for i < n && strings.ContainsRune(attrNameChars, rune(s[i])) {
			i++
		}
		if i == start {
			i++
			continue
		}
		name := s[start:i]
		// skip whitespace and '='
		for i < n && s[i] == ' ' {
			i++
		}
		if i < n && s[i] == '=' {
			i++
			for i < n && s[i] == ' ' {
				i++
			}
			if i < n {
				quote := s[i]
				val := ""
				switch quote {
				case '"', '\'':
					i++
					vs := i
					for i < n && s[i] != quote {
						i++
					}
					val = s[vs:i]
					if i < n {
						i++
					}
				default:
					vs := i
					for i < n && s[i] != ' ' {
						i++
					}
					val = s[vs:i]
				}
				m[strings.ToLower(name)] = val
			}
		} else {
			m[strings.ToLower(name)] = ""
		}
	}
	return m
}

func stableSlug(name string) string {
	h := sha1.Sum([]byte(strings.ToLower(strings.TrimSpace(name))))
	return hex.EncodeToString(h[:12])
}

func UserChannelIDSource(playlistName string) string {
	return "user:" + strings.TrimSpace(strings.ToLower(playlistName))
}

func (e M3UEntry) IDFor(playlistName string) string {
	if e.Attrs != nil {
		if tvg := e.Attrs["tvg-id"]; tvg != "" {
			return UserChannelIDSource(playlistName) + ":" + stableSlug(tvg)
		}
	}
	if e.URL != "" {
		return UserChannelIDSource(playlistName) + ":" + stableSlug(e.URL)
	}
	return UserChannelIDSource(playlistName) + ":" + stableSlug(e.Name)
}

func (e M3UEntry) Validate() error {
	if e.Name == "" {
		return fmt.Errorf("entry missing name")
	}
	if !strings.Contains(e.URL, "://") {
		return fmt.Errorf("missing stream URL for %s", e.Name)
	}
	return nil
}
