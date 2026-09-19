package ojson

import (
	"bytes"
	"testing"
)

// FuzzRoundTrip checks the canonical-form claim: encoding is a fixed point
// after one normalization, and parsing an encoding yields an equal value.
func FuzzRoundTrip(f *testing.F) {
	f.Add([]byte(`{"a":[1,2.5,"x",null,true],"b":{"c":{}}}`))
	f.Add([]byte("{\n  \"a\": 1\n}\n"))
	f.Add([]byte(`[]`))
	f.Add([]byte(`" "`))
	f.Fuzz(func(t *testing.T, data []byte) {
		v, err := Parse(data)
		if err != nil {
			return
		}
		st := DetectStyle(data)
		one, err := Encode(v, st)
		if err != nil {
			t.Fatal(err)
		}
		v2, err := Parse(one)
		if err != nil {
			t.Fatalf("re-parse failed: %v\n%s", err, one)
		}
		if !Equal(v, v2) {
			t.Fatalf("value changed by round trip")
		}
		two, _ := Encode(v2, DetectStyle(one))
		if !bytes.Equal(one, two) {
			t.Fatalf("encoding is not a fixed point:\n%q\n%q", one, two)
		}
	})
}
