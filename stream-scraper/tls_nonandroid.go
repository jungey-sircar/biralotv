//go:build !android

package main

import "crypto/tls"

func platformTLSConfig() *tls.Config {
	return nil
}

