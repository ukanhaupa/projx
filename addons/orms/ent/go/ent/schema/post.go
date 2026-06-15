package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Post struct {
	ent.Schema
}

func (Post) Mixin() []ent.Mixin {
	return []ent.Mixin{
		SoftDeleteMixin{},
	}
}

func (Post) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
		field.String("title").NotEmpty().MaxLen(200),
		field.Text("body").Default(""),
		field.Bool("published").Default(false),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Post) Annotations() []schema.Annotation {
	return nil
}

func (Post) Edges() []ent.Edge {
	return nil
}

func (Post) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("title"),
	}
}
