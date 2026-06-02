package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Session struct {
	ent.Schema
}

func (Session) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
		field.String("user_id"),
		field.String("session_id"),
		field.String("token_hash").MaxLen(128),
		field.String("ip_address").Optional().MaxLen(64),
		field.Text("user_agent").Optional(),
		field.Time("expires_at"),
		field.Time("revoked_at").Optional().Nillable(),
		field.String("rotated_to").Optional().Nillable(),
		field.Time("replay_detected_at").Optional().Nillable(),
		field.String("parent_session_id").Optional().Nillable(),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Session) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("owner", User.Type).
			Ref("sessions").
			Field("user_id").
			Unique().
			Required(),
		edge.To("children", Session.Type).
			From("parent").
			Field("parent_session_id").
			Unique(),
	}
}

func (Session) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("token_hash").Unique(),
		index.Fields("user_id"),
		index.Fields("session_id"),
		index.Fields("expires_at"),
		index.Fields("revoked_at"),
		index.Fields("parent_session_id"),
	}
}
