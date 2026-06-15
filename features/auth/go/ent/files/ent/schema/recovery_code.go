package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type RecoveryCode struct {
	ent.Schema
}

func (RecoveryCode) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
		field.String("user_id"),
		field.String("code_hash").MaxLen(255),
		field.Time("consumed_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now).Immutable(),
	}
}

func (RecoveryCode) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("owner", User.Type).
			Ref("recovery_codes").
			Field("user_id").
			Unique().
			Required(),
	}
}

func (RecoveryCode) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("code_hash").Unique(),
		index.Fields("user_id"),
	}
}
