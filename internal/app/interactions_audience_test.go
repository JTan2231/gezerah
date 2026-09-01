package app

import "testing"

func TestPLYV01InteractionAudienceDefaultsOnlyWhenOmitted(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name            string
		defaultAudience bool
		audienceOmitted bool
		want            bool
	}{
		{name: "omitted create audience uses the default Play audience", defaultAudience: true, audienceOmitted: true, want: true},
		{name: "explicitly empty draft audience remains empty", defaultAudience: true, audienceOmitted: false, want: false},
		{name: "stored presentation validation never invents an audience", defaultAudience: false, audienceOmitted: true, want: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := shouldDefaultInteractionAudience(testCase.defaultAudience, testCase.audienceOmitted); got != testCase.want {
				t.Fatalf("shouldDefaultInteractionAudience(%t, %t) = %t, want %t", testCase.defaultAudience, testCase.audienceOmitted, got, testCase.want)
			}
		})
	}
}
