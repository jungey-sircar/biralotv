package main

import "testing"

func TestParseSource(t *testing.T) {
	cases := map[string]string{
		"":        "server1",
		"server1": "server1",
		"1":       "server1",
		"server2": "server2",
		"2":       "server2",
		"server3": "server3",
		"3":       "server3",
	}
	for in, want := range cases {
		got, ok := parseSource(in)
		if !ok || got.alias != want {
			t.Fatalf("parseSource(%q) = %+v, %v; want %s", in, got, ok, want)
		}
	}
	if _, ok := parseSource("server4"); ok {
		t.Fatal("server4 must be rejected")
	}
}

func TestSourceNumbers(t *testing.T) {
	cases := map[string]int{
		"server1": 1,
		"server2": 2,
		"server3": 3,
	}
	for alias, number := range cases {
		got, ok := parseSource(alias)
		if !ok || got.number != number {
			t.Fatalf("%s number = %d, want %d", alias, got.number, number)
		}
	}
}

func TestParseTMDB(t *testing.T) {
	for _, good := range []string{"1", "603", "1399"} {
		if _, ok := parseTMDB(good); !ok {
			t.Fatalf("parseTMDB(%q) failed", good)
		}
	}
	for _, bad := range []string{"", "0", "-1", "abc", "1.5"} {
		if _, ok := parseTMDB(bad); ok {
			t.Fatalf("parseTMDB(%q) accepted", bad)
		}
	}
}

func TestSource1Order(t *testing.T) {
	for _, requested := range []string{"miami", "delhi", "berlin"} {
		order := mirrorOrder(requested)
		if len(order) != source1Tries {
			t.Fatalf("%s: got %d mirrors, want %d", requested, len(order), source1Tries)
		}
		if order[0] != requested {
			t.Fatalf("%s: first mirror is %s", requested, order[0])
		}
		seen := map[string]bool{}
		for _, mirror := range order {
			if seen[mirror] {
				t.Fatalf("%s: %s appears twice", requested, mirror)
			}
			seen[mirror] = true
		}
	}
}

func TestValidMirror(t *testing.T) {
	if got := validMirror("BERLIN"); got != "berlin" {
		t.Fatalf("validMirror = %q", got)
	}
	if got := validMirror("unknown"); got != "miami" {
		t.Fatalf("unknown mirror = %q, want miami", got)
	}
}
