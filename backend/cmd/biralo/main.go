package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"biralotv/backend/internal/api"
	"biralotv/backend/internal/config"
	"biralotv/backend/internal/scraper"
	"biralotv/backend/internal/store"
)

func main() {
	cfg := config.Load()
	log.Printf("biralotv starting: addr=%s data=%s", cfg.ListenAddr, cfg.DataDir)

	st, err := store.Open(cfg.DBPath())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer st.Close()

	sc := scraper.New(st, cfg)
	srv := &api.Server{Store: st, Scraper: sc}

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// decide whether we need an initial scrape
	needsInit := false
	counts, err := st.CountBySource()
	if err != nil || len(counts) == 0 {
		needsInit = true
	}
	log.Printf("initialized sources: %v (needsInit=%v)", counts, needsInit)

	go func() {
		if !needsInit {
			return
		}
		log.Printf("database empty; running initial scrape (mapple-premium)")
		// warm-up delay so the server accepts requests right away
		time.Sleep(500 * time.Millisecond)
		if err := sc.Scrape(scraper.SourcePremium, false); err != nil {
			if !errors.Is(err, scraper.ErrBusy) {
				log.Printf("initial scrape: %v", err)
			}
		}
	}()

	go func() {
		log.Printf("listening on %s", cfg.ListenAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	log.Printf("bye")
}
