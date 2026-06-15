package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type EmailVerifyToken struct {
	ent.Schema
}

func (EmailVerifyToken) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
		field.String("user_id"),
		field.String("token_hash").MaxLen(128),
		field.Time("expires_at"),
		field.Time("consumed_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now).Immutable(),
	}
}

func (EmailVerifyToken) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("owner", User.Type).
			Ref("email_verify_tokens").
			Field("user_id").
			Unique().
			Required(),
	}
}

func (EmailVerifyToken) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("token_hash").Unique(),
		index.Fields("user_id"),
		index.Fields("expires_at"),
	}
}
