package main

// Decryption for the media provider. The payload arrives XORed and seeded by a
// small JS routine; goja runs it. A pool of prepared runtimes keeps the script
// compiled while letting concurrent requests each have their own VM.

import (
	"encoding/base64"
	"fmt"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

var vmPool = sync.Pool{New: func() interface{} { return newVM() }}

func newVM() *goja.Runtime {
	vm := goja.New()
	vm.Set("__atobGo", func(s string) string {
		raw := s
		if strings.ContainsAny(raw, "-_") {
			raw = strings.NewReplacer("-", "+", "_", "/").Replace(raw)
		}
		if pad := len(raw) % 4; pad != 0 {
			raw += strings.Repeat("=", 4-pad)
		}
		b, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return ""
		}
		runes := make([]rune, len(b))
		for i, by := range b {
			runes[i] = rune(by)
		}
		return string(runes)
	})
	vm.RunString(`globalThis.atob = function(s) { return __atobGo(s); };`)
	vm.RunString(`
        globalThis.TextDecoder = function(encoding) {
            this.decode = function(bytes) {
                var r = "";
                for (var i = 0; i < bytes.length; i++) {
                    r += String.fromCharCode(bytes[i]);
                }
                return decodeURIComponent(escape(r));
            };
        };
    `)
	vm.RunString(`
        var l = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580];
        var u = [109,118,109,49];
        var c = e => (e*(e+1)&1)==0;
        var I = e => (e*(e+1)&1)==1;
        function m(e){return e>>>=0,e^=e>>>16,e=Math.imul(e,2246822507)>>>0,e^=e>>>13,e=Math.imul(e,3266489909)>>>0,(e^=e>>>16)>>>0}
        function p(e,t){return(e>>>=0,0==(t&=31))?e>>>0:(e<<t|e>>>32-t)>>>0}

        function __padEnd(s,n){s=String(s);while(s.length<n)s+="=";return s}
        function __inner(e,t,a) {
            e = e.replace(/-/g,"+").replace(/_/g,"/");
            var s;
            let o = function(e){
                let t = __padEnd(e, 4*Math.ceil(e.length/4));
                let d = globalThis.atob(t);
                let a = new Uint8Array(d.length);
                for(let t=0; t<d.length; t++) a[t] = d.charCodeAt(t);
                return a;
            }(e),
            n = function(e,t,a){
                let s = function(e,t){
                    if(I(e.length)) return {
                        S: function(e){ let t=Array(256); for(let e=0;e<256;e++) t[e]=e; let a=0; for(let s=0;s<256;s++){ a=a+t[s]+e.charCodeAt(s%e.length)&255; let o=t[s]; t[s]=t[a], t[a]=o; } return t; }(e),
                        acc: function(e){ let t=1732584193; for(let a=0; a<e.length; a++) t=p((t^Math.imul(e.charCodeAt(a),l[15&a]))>>>0,5); return m(t); }(e)
                    };
                    let a = Array(61), s = m(function(e){ let t=2166136261; for(let a=0;a<e.length;a++) t=Math.imul(t^e.charCodeAt(a),16777619)>>>0; return m(t); }(e) ^ m(t>>>0^2654435769))>>>0;
                    for(let e=0; e<8; e++) if(c(e)) { let t=s%61; s=p(s+2654435769>>>0,7+(7&e)), a[t]=(s^m(s))>>>0, s=m(s+t>>>0); } else a[e]=l[15&e];
                    return {S:a, acc:m(2779096485^s)>>>0};
                }(e,t),
                o = new Uint8Array(a), n = 0;
                for(let e=0; e<a;) {
                    let t = function(e,t){ var a,s; let o=e.S, n=e.acc, d=n%61, r=0-Number(d in o), i=o[d]>>>0, l=(((a=n)^(s=(i^Math.imul(2654435769,t+1)>>>0)>>>0))>>>0|(a&s&r)>>>0)>>>0; return n=m((l=(p(l+n>>>0,31&d)^p(n,31&Math.imul(d,7)))>>>0)+2654435769>>>0), o[d]=n>>>0, e.acc=n, n>>>0; }(s,n++);
                    o[e++] = 255 & t;
                    e<a && (o[e++] = t>>>8 & 255);
                    e<a && (o[e++] = t>>>16 & 255);
                    e<a && (o[e++] = t>>>24 & 255);
                }
                return o;
            }(t, a, o.length);
            for(let e=0; e<o.length; e++) o[e] ^= n[e];
            for(let e=0; e<u.length; e++) if(o[e] !== u[e]) throw Error("decrypt failed: bad seed or tampered payload");
            return s = o.subarray(u.length), "undefined"!=typeof TextDecoder ? new TextDecoder("utf-8").decode(s) : globalThis.Buffer.from(s).toString("utf8");
        }

        globalThis.__inner = __inner;
    `)
	return vm
}

func jsDecrypt(payload, seed, mediaID string) (string, error) {
	vm := vmPool.Get().(*goja.Runtime)
	defer vmPool.Put(vm)
	v, err := vm.RunString(fmt.Sprintf("__inner(%q,%q,%q)", payload, seed, mediaID))
	if err != nil {
		return "", err
	}
	return v.String(), nil
}
