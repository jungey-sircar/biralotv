package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr string
	DataDir    string
	RefreshTTL int // hours a resolved stream is trusted before re-resolving
	Concurrency int
	TimeoutSec int
}

func Load() Config {
	c := Config{
		ListenAddr:  ":8080",
		DataDir:     "data",
		RefreshTTL:  24,
		Concurrency: 24,
		TimeoutSec:  15,
	}
	if v := os.Getenv("BIRALO_ADDR"); v != "" {
		c.ListenAddr = v
	}
	if v := os.Getenv("BIRALO_DATA"); v != "" {
		c.DataDir = v
	}
	if v := os.Getenv("BIRALO_TTL_HOURS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.RefreshTTL = n
		}
	}
	if v := os.Getenv("BIRALO_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.Concurrency = n
		}
	}
	if v := os.Getenv("BIRALO_HTTP_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.TimeoutSec = n
		}
	}
	return c
}

func (c Config) DBPath() string {
	return strings.TrimSuffix(c.DataDir, "/") + "/biralotv.db"
}
