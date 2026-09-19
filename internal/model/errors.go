// Package model holds the Foundation's domain vocabulary: artifact kinds,
// identity rules, folder rules, schemas, workflows and overlay resolution.
// It is pure (no Git, no database) so every rule is unit-testable.
package model

import (
	"errors"
	"fmt"
)

// Sentinel errors. Callers wrap them with context; the HTTP layer maps
// them to status codes.
var (
	ErrNotFound     = errors.New("not found")
	ErrValidation   = errors.New("validation failed")
	ErrConflict     = errors.New("conflict")
	ErrPrecondition = errors.New("precondition failed")
	ErrUnavailable  = errors.New("temporarily unavailable")
	ErrMaintenance  = errors.New("repository is in maintenance mode")
)

// Invalid returns a validation error with a formatted message.
func Invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrValidation, fmt.Sprintf(format, args...))
}
