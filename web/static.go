package web

import "embed"

// Static contains the production frontend emitted by Vite.
//
//go:embed static
var Static embed.FS

// Site contains the tracked joeytan.dev snapshot served outside the Wrought
// application mount. The all: prefix includes .well-known association files.
//
//go:embed all:site
var Site embed.FS
