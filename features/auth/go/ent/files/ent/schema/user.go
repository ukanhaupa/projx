package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type User struct {
	ent.Schema
}

func (User) Mixin() []ent.Mixin {
	return []ent.Mixin{
		SoftDeleteMixin{},
	}
}

func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique().Immutable(),
		field.String("email").NotEmpty().MaxLen(255),
		field.String("name").NotEmpty().MaxLen(255),
		field.String("password_hash").Optional().MaxLen(255),
		field.String("role").Default("user").MaxLen(32),
		field.Bool("email_verified").Default(false),
		field.Time("email_verified_at").Optional().Nillable(),
		field.Int("failed_login_count").Default(0),
		field.Time("locked_until").Optional().Nillable(),
		field.Bool("mfa_enabled").Default(false),
		field.Text("mfa_secret_enc").Optional(),
		field.Time("mfa_verified_at").Optional().Nillable(),
		field.Int("mfa_failed_count").Default(0),
		field.Time("mfa_locked_until").Optional().Nillable(),
		field.Time("last_login").Optional().Nillable(),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("sessions", Session.Type),
		edge.To("password_reset_tokens", PasswordResetToken.Type),
		edge.To("email_verify_tokens", EmailVerifyToken.Type),
		edge.To("recovery_codes", RecoveryCode.Type),
	}
}

func (User) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("email").Unique(),
		index.Fields("role"),
	}
}

func (User) Annotations() []schema.Annotation {
	return nil
}
