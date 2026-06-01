package entities

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"projx.local/go/internal/apperr"
	"projx.local/go/internal/httputil"
	"projx.local/go/internal/requestid"
)

func MountEntity(r chi.Router, cfg EntityConfig) {
	r.Route(cfg.BasePath, func(sub chi.Router) {
		sub.Method(http.MethodGet, "/", apperr.H(listHandler(cfg)))
		sub.Method(http.MethodPost, "/", apperr.H(createHandler(cfg)))
		sub.Method(http.MethodPost, "/bulk", apperr.H(bulkCreateHandler(cfg)))
		sub.Method(http.MethodDelete, "/bulk", apperr.H(bulkDeleteHandler(cfg)))
		sub.Method(http.MethodGet, "/{id}", apperr.H(getHandler(cfg)))
		sub.Method(http.MethodPatch, "/{id}", apperr.H(updateHandler(cfg)))
		sub.Method(http.MethodDelete, "/{id}", apperr.H(deleteHandler(cfg)))
	})
}

func listHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		params := ParseListParams(r.URL.Query(), cfg)
		page, err := cfg.Querier.List(r.Context(), params)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		meta := PageMetaFor(page.Total, params)
		return httputil.WriteJSON(w, http.StatusOK, PageResult{Data: page.Items, Pagination: meta})
	}
}

func getHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		rec, err := cfg.Querier.Get(r.Context(), id)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		return httputil.WriteJSON(w, http.StatusOK, rec)
	}
}

func createHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return apperr.Validation("failed to read body")
		}
		if !json.Valid(body) {
			return apperr.Validation("invalid JSON body")
		}
		if cfg.Hooks.BeforeCreate != nil {
			body, err = cfg.Hooks.BeforeCreate(r, body)
			if err != nil {
				return err
			}
		}
		rec, err := cfg.Querier.Create(r.Context(), body)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		if cfg.Hooks.AfterCreate != nil {
			runBestEffort(r, cfg.Name, "after_create", func() { cfg.Hooks.AfterCreate(r, rec) })
		}
		return httputil.WriteJSON(w, http.StatusCreated, rec)
	}
}

func updateHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		before, err := cfg.Querier.Get(r.Context(), id)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			return apperr.Validation("failed to read body")
		}
		var rawMap map[string]json.RawMessage
		if err := json.Unmarshal(body, &rawMap); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		patch := allowedPatch(cfg, rawMap)

		if cfg.Hooks.BeforeUpdate != nil {
			handled, err := cfg.Hooks.BeforeUpdate(r, w, patch)
			if err != nil {
				return err
			}
			if handled {
				return nil
			}
		}

		after, err := cfg.Querier.Update(r.Context(), id, patch)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		if cfg.Hooks.AfterUpdate != nil {
			runBestEffort(r, cfg.Name, "after_update", func() { cfg.Hooks.AfterUpdate(r, before, after) })
		}
		return httputil.WriteJSON(w, http.StatusOK, after)
	}
}

func deleteHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if cfg.Hooks.BeforeDelete != nil {
			if err := cfg.Hooks.BeforeDelete(r, id); err != nil {
				return err
			}
		}
		if err := cfg.Querier.Delete(r.Context(), id); err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func bulkCreateHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return apperr.Validation("failed to read body")
		}
		var raws []json.RawMessage
		if err := json.Unmarshal(body, &raws); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		if len(raws) == 0 {
			return apperr.Validation("body must be a non-empty array")
		}
		payloads := make([][]byte, 0, len(raws))
		for _, raw := range raws {
			item := []byte(raw)
			if cfg.Hooks.BeforeCreate != nil {
				item, err = cfg.Hooks.BeforeCreate(r, item)
				if err != nil {
					return err
				}
			}
			payloads = append(payloads, item)
		}
		recs, err := cfg.Querier.BulkCreate(r.Context(), payloads)
		if err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		if cfg.Hooks.AfterCreate != nil {
			for _, rec := range recs {
				rec := rec
				runBestEffort(r, cfg.Name, "after_create", func() { cfg.Hooks.AfterCreate(r, rec) })
			}
		}
		return httputil.WriteJSON(w, http.StatusCreated, recs)
	}
}

func bulkDeleteHandler(cfg EntityConfig) apperr.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return apperr.Validation("invalid JSON body")
		}
		if len(body.IDs) == 0 {
			return apperr.Validation("ids must be a non-empty array")
		}
		if cfg.Hooks.BeforeDelete != nil {
			for _, id := range body.IDs {
				if err := cfg.Hooks.BeforeDelete(r, id); err != nil {
					return err
				}
			}
		}
		if err := cfg.Querier.BulkDelete(r.Context(), body.IDs); err != nil {
			return apperr.FromDB(err, cfg.Name)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func allowedPatch(cfg EntityConfig, rawMap map[string]json.RawMessage) map[string]any {
	patch := map[string]any{}
	updatable := cfg.UpdatableColumns
	if len(updatable) == 0 {
		updatable = cfg.Columns
	}
	hidden := map[string]struct{}{}
	for _, h := range cfg.HiddenFields {
		hidden[h] = struct{}{}
	}
	for _, col := range updatable {
		if _, isHidden := hidden[col]; isHidden {
			continue
		}
		raw, present := rawMap[col]
		if !present {
			continue
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		patch[col] = v
	}
	return patch
}

func runBestEffort(r *http.Request, name, phase string, fn func()) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("hook panicked",
				"request_id", requestid.FromContext(r.Context()),
				"entity", name,
				"phase", phase,
				"panic", rec,
			)
		}
	}()
	fn()
}

var ErrNotFound = errors.New("not found")
