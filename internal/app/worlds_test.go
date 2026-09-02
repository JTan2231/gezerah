package app

import (
	"strings"
	"testing"
)

func TestValidateWorldProseGuide(t *testing.T) {
	t.Parallel()

	fields := map[string]string{}
	validateWorldProseGuide(fields, nil)
	guide := strings.Repeat("界", maxWorldProseGuideLength)
	validateWorldProseGuide(fields, &guide)
	if len(fields) != 0 {
		t.Fatalf("valid prose guide fields = %#v", fields)
	}

	tooLong := guide + "界"
	validateWorldProseGuide(fields, &tooLong)
	if fields["prose_guide"] != "must be at most 10000 characters" {
		t.Fatalf("long prose guide fields = %#v", fields)
	}
}
