package web

import "embed"

// Static contains the production frontend emitted by Vite.
//
//go:embed static
var Static embed.FS
