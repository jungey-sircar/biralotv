package main

import (
	"context"
	"errors"
)

var errSource3NoSource = errors.New("source3: no secondary catalog source")

// buildSource3Payload is the secondary catalog only. No fallback: when the
// secondary catalog has no source the title is reported unavailable instead of
// being served by the primary catalog.
func buildSource3Payload(ctx context.Context, base, kind, id string, season, episode int) (*resolvedMedia, error) {
	return buildCatalogPayload(ctx, base, kind, id, season, episode, []int{source2Secondary}, errSource3NoSource)
}
