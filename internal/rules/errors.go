package rules

import (
	"errors"
	"fmt"
	"strings"
)

var (
	ErrInvalidDefinition      = errors.New("invalid definition")
	ErrInvalidRuntimeSnapshot = errors.New("invalid runtime snapshot")
	ErrInvalidTransition      = errors.New("invalid transition")
	ErrEffectApplication      = errors.New("effect application failed")
	ErrEvaluation             = errors.New("evaluation failed")
)

type ValidationError struct {
	Code    string
	Path    string
	Message string
}

func (e ValidationError) Error() string {
	if e.Path == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Path, e.Message)
}

type ValidationErrors []ValidationError

func (e ValidationErrors) Error() string {
	if len(e) == 0 {
		return "validation failed"
	}
	parts := make([]string, 0, len(e))
	for _, item := range e {
		parts = append(parts, item.Error())
	}
	return strings.Join(parts, "; ")
}

func (e ValidationErrors) AsError() error {
	if len(e) == 0 {
		return nil
	}
	return e
}

func validation(code, path, message string) ValidationError {
	return ValidationError{Code: code, Path: path, Message: message}
}

// DomainError identifies a runtime validation or application failure while
// retaining machine-readable field errors for HTTP adapters.
type DomainError struct {
	Kind   error
	Errors ValidationErrors
}

func (e *DomainError) Error() string {
	if len(e.Errors) == 0 {
		return e.Kind.Error()
	}
	return fmt.Sprintf("%s: %s", e.Kind, e.Errors)
}

func (e *DomainError) Unwrap() error { return e.Kind }

func domainError(kind error, errs ValidationErrors) error {
	if len(errs) == 0 {
		return nil
	}
	return &DomainError{Kind: kind, Errors: errs}
}
