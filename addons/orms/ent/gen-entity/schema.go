package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type __ENTITY_PASCAL__ struct {
	ent.Schema
}

func (__ENTITY_PASCAL__) Mixin() []ent.Mixin {
	return []ent.Mixin{
__MIXIN_LIST__
	}
}

func (__ENTITY_PASCAL__) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
__SCHEMA_FIELDS__
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (__ENTITY_PASCAL__) Annotations() []schema.Annotation {
	return nil
}

func (__ENTITY_PASCAL__) Edges() []ent.Edge {
	return nil
}

func (__ENTITY_PASCAL__) Indexes() []ent.Index {
	return []ent.Index{
__SCHEMA_INDEXES__
	}
}
