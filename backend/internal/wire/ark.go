package wire

import "github.com/songguo/songguo/internal/calls"

func init() {
	// Volcengine Ark video generation (Doubao Seedance) is an async task API:
	// POST /contents/generations/tasks creates a job and returns a task id with
	// no usage object; the result is fetched later by polling .../tasks/{id}.
	// There is nothing to meter inline, so the create call is billed per_call
	// as a flat placeholder. The polling/list GETs on .../tasks/{id} carry a
	// variable id suffix that does not match here and fall through to the
	// service's unmatched handling.
	register(Wire{
		Name:     "ark/video",
		Suffixes: []string{"/contents/generations/tasks"},
		Modality: calls.ModalityVideo,
		Extract:  perCallExtract,
	})
}
