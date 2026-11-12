//go:build android && cgo

package main

import "C"

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

func main() {}

func platformTLSConfig() *tls.Config {
	pool, err := x509.SystemCertPool()
	needSystemScan := err != nil || pool == nil
	if needSystemScan {
		pool = x509.NewCertPool()
	}
	dirs := []string{"/apex/com.android.conscrypt/cacerts"}
	if needSystemScan {
		dirs = append(dirs, "/system/etc/security/cacerts", "/data/misc/keychain/certs-added")
	}
	for _, dir := range dirs {
		entries, readErr := os.ReadDir(dir)
		if readErr != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			pemBytes, fileErr := os.ReadFile(filepath.Join(dir, e.Name()))
			if fileErr != nil {
				continue
			}
			pool.AppendCertsFromPEM(pemBytes)
		}
	}
	return &tls.Config{RootCAs: pool}
}

var (
	embeddedMu   sync.Mutex
	embeddedPort int
)

//export StartEmbeddedScraper
func StartEmbeddedScraper() C.int {
	embeddedMu.Lock()
	defer embeddedMu.Unlock()

	if embeddedPort > 0 {
		return C.int(embeddedPort)
	}

	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		log.Printf("android scraper listen error: %v", err)
		return -1
	}
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || addr.Port <= 0 {
		_ = ln.Close()
		return -1
	}
	embeddedPort = addr.Port
	_ = os.Setenv("PUBLIC_BASE_URL", "http://127.0.0.1:"+strconv.Itoa(embeddedPort))

	srv := &http.Server{
		Handler:           newRouter(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			sweepSeeds()
			streams.sweep()
			sweepSubtitles()
		}
	}()

	go func() {
		log.Printf("stream-scraper %s (android) listening on 127.0.0.1:%d", apiVersion, embeddedPort)
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			log.Printf("android scraper server stopped: %v", serveErr)
			embeddedMu.Lock()
			embeddedPort = 0
			embeddedMu.Unlock()
		}
	}()

	return C.int(embeddedPort)
}

