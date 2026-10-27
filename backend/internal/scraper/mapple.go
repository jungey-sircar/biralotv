package scraper

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"biralotv/backend/internal/config"
	"biralotv/backend/internal/models"
	"biralotv/backend/internal/store"
)

const (
	SourcePremium = "mapple-premium"
	SourceSports  = "mapple-sports"
	SourceAll     = "mapple-all" // sentinel to scrape every section


)

var ErrBusy = errors.New("a scrape is already running")

type progress struct {
	running atomic.Bool
	source  atomic.Value // string
	done    atomic.Int64
	total   atomic.Int64
	failed  atomic.Int64
	started atomic.Value // time.Time
	lastOK  atomic.Value // time.Time
}

type Scraper struct {
	http *HTTP
	st   *store.Store
	cfg  config.Config
	p    progress
}

func New(st *store.Store, cfg config.Config) *Scraper {
	return &Scraper{
		http: NewHTTP(time.Duration(cfg.TimeoutSec)*time.Second, cfg.Concurrency),
		st:   st,
		cfg:  cfg,
	}
}

func (s *Scraper) Status() models.ScrapeStatus {
	pr := &s.p
	st := models.ScrapeStatus{
		Running: pr.running.Load(),
		Done:    pr.done.Load(),
		Total:   pr.total.Load(),
		Failed:  pr.failed.Load(),
	}
	if v, ok := pr.source.Load().(string); ok {
		st.Source = v
	}
	if v, ok := pr.started.Load().(time.Time); ok {
		st.Started = v
	}
	if v, ok := pr.lastOK.Load().(time.Time); ok && !v.IsZero() {
		st.LastOK = v
	}
	return st
}

// numFromHref extracts the numeric id from an href like "/live-tv-premium/1011".
func numFromHref(href string) string {
	parts := strings.Split(strings.Trim(href, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func (s *Scraper) begin(source string) {
	now := time.Now()
	s.p.running.Store(true)
	s.p.source.Store(source)
	s.p.done.Store(0)
	s.p.total.Store(0)
	s.p.failed.Store(0)
	s.p.started.Store(now)
}

func (s *Scraper) end() {
	s.p.running.Store(false)
}

// The site renders channels as SSR HTML with embedded Next.js RSC payload.
const listingURL = "https://mapple.fun/live-tv-premium"

// channelCardRe matches each channel anchor tag and captures channel number and inner HTML.
var channelCardRe = regexp.MustCompile(`(?s)<a\s+[^>]*?href="/live-tv-premium/(\d+)"[^>]*?>(.*?)</a>`)
var ariaLabelRe = regexp.MustCompile(`aria-label="([^"]+)"`)
var imgSrcRe = regexp.MustCompile(`src="([^"]+)"`)
var pageLinkRe = regexp.MustCompile(`[?&]page=(\d+)`)
var totalPagesJSONRe = regexp.MustCompile(`(?:\\"|"|&quot;)totalPages(?:\\"|"|&quot;):(\d+)`)

// fetchListingPage fetches one page of the premium listing via HTML scraping.
func (s *Scraper) fetchListingPage(page int) ([]ListingChannel, int, error) {
	url := listingURL
	if page > 1 {
		url = fmt.Sprintf("%s?page=%d", listingURL, page)
	}
	body, err := s.http.GetWithRetry(url, map[string]string{
		"Referer": "https://mapple.fun/",
	}, 2)
	if err != nil {
		return nil, 0, err
	}

	// Extract channels from HTML
	matches := channelCardRe.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return nil, 0, fmt.Errorf("page %d: no channel links found in HTML", page)
	}

	seen := map[string]bool{}
	var chs []ListingChannel
	for _, m := range matches {
		num := m[1]
		if seen[num] {
			continue
		}
		seen[num] = true

		fullTag := m[0]
		inner := m[2]

		title := ""
		if lm := ariaLabelRe.FindStringSubmatch(fullTag); len(lm) >= 2 {
			title = html.UnescapeString(lm[1])
		} else {
			title = fmt.Sprintf("Channel %s", num)
		}

		logo := ""
		if im := imgSrcRe.FindStringSubmatch(inner); len(im) >= 2 {
			logo = im[1]
		}

		chs = append(chs, ListingChannel{
			ID:    num,
			Title: title,
			Logo:  logo,
			Href:  "/live-tv-premium/" + num,
		})
	}

	// Extract total pages from pagination links or embedded Next.js JSON
	totalPages := 0
	if tm := totalPagesJSONRe.FindStringSubmatch(body); len(tm) >= 2 {
		fmt.Sscanf(tm[1], "%d", &totalPages)
	}

	pageLinks := pageLinkRe.FindAllStringSubmatch(body, -1)
	for _, pl := range pageLinks {
		var p int
		fmt.Sscanf(pl[1], "%d", &p)
		if p > totalPages {
			totalPages = p
		}
	}

	return chs, totalPages, nil
}

// fetchListing returns all premium channels through HTML page pagination.
func (s *Scraper) fetchListing() ([]ListingChannel, error) {
	all := []ListingChannel{}
	seen := map[string]bool{}
	first, totalPages, err := s.fetchListingPage(1)
	if err != nil {
		return nil, err
	}
	if totalPages <= 0 {
		totalPages = 50 // safe fallback
	}
	for _, c := range first {
		if c.ID != "" && !seen[c.ID] {
			seen[c.ID] = true
			all = append(all, c)
		}
	}
	for page := 2; page <= totalPages; page++ {
		time.Sleep(200 * time.Millisecond)
		chs, _, err := s.fetchListingPage(page)
		if err != nil {
			return all, fmt.Errorf("listing page %d: %w", page, err)
		}
		fresh := 0
		for _, c := range chs {
			if c.ID == "" || seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			all = append(all, c)
			fresh++
		}
		if fresh == 0 {
			break
		}
	}
	return all, nil
}

// resolveStream walks the dlive -> dembed chain to obtain the m3u8 for a channel number.
func (s *Scraper) resolveStream(num string) (string, error) {
	page, err := s.http.GetWithRetry("https://dlive.sx/stream/stream-"+num+".php", map[string]string{
		"Referer": "https://mapple.fun/",
	}, 2)
	if err != nil {
		return "", err
	}
	iframe := extractIframeSrc(page)
	if iframe == "" {
		return "", fmt.Errorf("no iframe for stream-%s", num)
	}
	player, err := s.http.GetWithRetry(iframe, map[string]string{
		"Referer": "https://dlive.sx/stream/stream-" + num + ".php",
	}, 2)
	if err != nil {
		return "", err
	}
	m3u8 := firstM3U8(player)
	if m3u8 == "" {
		return "", fmt.Errorf("no m3u8 for stream-%s", num)
	}
	return m3u8, nil
}

// Scrape refreshes the given source. force=false caches per-channel results within cfg.RefreshTTL.
func (s *Scraper) Scrape(source string, force bool) error {
	if !s.p.running.CompareAndSwap(false, true) {
		return ErrBusy
	}
	defer s.end()
	if source == SourceAll {
		if err := s.scrapeOne(SourcePremium, force); err != nil {
			return err
		}
		return s.scrapeOne(SourceSports, force)
	}
	return s.scrapeOne(source, force)
}

func (s *Scraper) scrapeOne(source string, force bool) error {
	s.begin(source)
	s.p.failed.Store(0)

	chs, err := s.fetchListing()
	if err != nil && len(chs) == 0 {
		return fmt.Errorf("listing failed: %w", err)
	}
	s.p.total.Store(int64(len(chs)))

	ttl := time.Duration(s.cfg.RefreshTTL) * time.Hour
	jobs := make(chan ListingChannel, s.cfg.Concurrency*2)
	var upsertMu sync.Mutex // sqlite single writer handled by store mutex; keep counters cheap
	var wg sync.WaitGroup
	worker := func() {
		defer wg.Done()
		for c := range jobs {
			num := numFromHref(c.Href)
			id := "mapple:" + num
			if num == "" {
				num = c.ID
				id = "mapple:m" + c.ID
			}
			name := strings.TrimSpace(c.Title)
			group := "Live"
			if source == SourceSports {
				group = "Sports"
			}
			row := store.ChannelRow{ID: id, Name: name, Logo: c.Logo, Source: source, Gr: group, Number: num}
			if !force {
				if ok, _ := s.st.ChannelExistsFresh(id, ttl); ok {
					s.p.done.Add(1)
					continue
				}
			}
			if stream, err := s.resolveStream(num); err == nil && stream != "" {
				row.Stream = stream
				s.p.lastOK.Store(time.Now())
			} else {
				s.p.failed.Add(1)
			}
			upsertMu.Lock()
			uerr := s.st.UpsertChannel(row)
			upsertMu.Unlock()
			if uerr != nil {
				s.p.failed.Add(1)
			}
			s.p.done.Add(1)
		}
	}
	for i := 0; i < s.cfg.Concurrency; i++ {
		wg.Add(1)
		go worker()
	}
	for _, c := range chs {
		jobs <- c
	}
	close(jobs)
	wg.Wait()
	return nil
}
