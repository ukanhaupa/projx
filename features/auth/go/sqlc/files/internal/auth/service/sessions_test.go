package authservice

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"projx.local/go/internal/apperr"
)

type fakeQuerier struct {
	users        map[string]*User
	emails       map[string]string
	sessions     map[string]*Session
	tokenIndex   map[string]string
	revokeChain  [][]string
	revokeCalls  []string
}

func newFake() *fakeQuerier {
	return &fakeQuerier{
		users: map[string]*User{}, emails: map[string]string{},
		sessions: map[string]*Session{}, tokenIndex: map[string]string{},
	}
}

func (f *fakeQuerier) GetUserByID(_ context.Context, id string) (*User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return nil, apperr.NotFound("user")
}
func (f *fakeQuerier) GetUserByEmail(_ context.Context, email string) (*User, error) {
	if id, ok := f.emails[email]; ok {
		return f.users[id], nil
	}
	return nil, apperr.NotFound("user")
}
func (f *fakeQuerier) CountUsers(context.Context) (int64, error) { return int64(len(f.users)), nil }
func (f *fakeQuerier) CreateUser(_ context.Context, p CreateUserParams) (*User, error) {
	u := &User{ID: p.ID, Email: p.Email, PasswordHash: p.PasswordHash, Name: p.Name, Role: p.Role, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	f.users[p.ID] = u
	f.emails[p.Email] = p.ID
	return u, nil
}
func (f *fakeQuerier) UpdateUserPassword(_ context.Context, id, hash string) error {
	if u, ok := f.users[id]; ok {
		u.PasswordHash = hash
	}
	return nil
}
func (f *fakeQuerier) UpdateUserLastLogin(_ context.Context, id string) error {
	if u, ok := f.users[id]; ok {
		u.LastLoginAt = sql.NullTime{Valid: true, Time: time.Now()}
	}
	return nil
}
func (f *fakeQuerier) RecordLoginFailure(context.Context, string, int, int) (int32, sql.NullTime, error) {
	return 1, sql.NullTime{}, nil
}
func (f *fakeQuerier) SetUserMFA(context.Context, string, bool, sql.NullString) error    { return nil }
func (f *fakeQuerier) MarkEmailVerified(context.Context, string) error                   { return nil }

func (f *fakeQuerier) CreateSession(_ context.Context, p CreateSessionParams) (*Session, error) {
	s := &Session{
		ID: p.ID, UserID: p.UserID, RefreshTokenHash: p.RefreshTokenHash,
		ParentSessionID: p.ParentSessionID, IPAddress: p.IPAddress, UserAgent: p.UserAgent,
		ExpiresAt: p.ExpiresAt, CreatedAt: time.Now(),
	}
	f.sessions[p.ID] = s
	f.tokenIndex[p.RefreshTokenHash] = p.ID
	return s, nil
}
func (f *fakeQuerier) GetSessionByTokenHash(_ context.Context, hash string) (*Session, error) {
	id, ok := f.tokenIndex[hash]
	if !ok {
		return nil, apperr.NotFound("session")
	}
	return f.sessions[id], nil
}
func (f *fakeQuerier) GetSessionByID(_ context.Context, id string) (*Session, error) {
	if s, ok := f.sessions[id]; ok {
		return s, nil
	}
	return nil, apperr.NotFound("session")
}
func (f *fakeQuerier) RevokeSession(_ context.Context, id string) error {
	if s, ok := f.sessions[id]; ok {
		s.RevokedAt = sql.NullTime{Valid: true, Time: time.Now()}
		f.revokeCalls = append(f.revokeCalls, id)
	}
	return nil
}
func (f *fakeQuerier) RevokeSessionsForUser(context.Context, string, sql.NullString) error { return nil }
func (f *fakeQuerier) RevokeSessionChain(_ context.Context, ids []string) error {
	f.revokeChain = append(f.revokeChain, append([]string(nil), ids...))
	for _, id := range ids {
		if s, ok := f.sessions[id]; ok {
			s.RevokedAt = sql.NullTime{Valid: true, Time: time.Now()}
		}
	}
	return nil
}
func (f *fakeQuerier) GetSessionAncestors(_ context.Context, id string) ([]string, error) {
	out := []string{id}
	cur := id
	for {
		s, ok := f.sessions[cur]
		if !ok || !s.ParentSessionID.Valid {
			break
		}
		cur = s.ParentSessionID.String
		out = append(out, cur)
	}
	return out, nil
}
func (f *fakeQuerier) GetSessionDescendants(_ context.Context, id string) ([]string, error) {
	out := []string{id}
	queue := []string{id}
	for len(queue) > 0 {
		head := queue[0]
		queue = queue[1:]
		for sid, s := range f.sessions {
			if s.ParentSessionID.Valid && s.ParentSessionID.String == head {
				out = append(out, sid)
				queue = append(queue, sid)
			}
		}
	}
	return out, nil
}
func (f *fakeQuerier) ListActiveSessionsForUser(context.Context, string) ([]*Session, error) {
	return nil, nil
}
func (f *fakeQuerier) DeleteExpiredSessions(context.Context) error              { return nil }
func (f *fakeQuerier) CreatePasswordResetToken(context.Context, CreateTokenParams) error { return nil }
func (f *fakeQuerier) GetPasswordResetToken(context.Context, string) (*Token, error) {
	return nil, errors.New("not impl")
}
func (f *fakeQuerier) MarkPasswordResetTokenUsed(context.Context, string) error      { return nil }
func (f *fakeQuerier) DeleteExpiredPasswordResetTokens(context.Context) error        { return nil }
func (f *fakeQuerier) CreateEmailVerifyToken(context.Context, CreateTokenParams) error { return nil }
func (f *fakeQuerier) GetEmailVerifyToken(context.Context, string) (*Token, error) {
	return nil, errors.New("not impl")
}
func (f *fakeQuerier) MarkEmailVerifyTokenUsed(context.Context, string) error      { return nil }
func (f *fakeQuerier) DeleteExpiredEmailVerifyTokens(context.Context) error        { return nil }
func (f *fakeQuerier) CreateRecoveryCode(context.Context, CreateTokenParams) error { return nil }
func (f *fakeQuerier) GetUnusedRecoveryCodes(context.Context, string) ([]*RecoveryCode, error) {
	return nil, nil
}
func (f *fakeQuerier) MarkRecoveryCodeUsed(context.Context, string) error      { return nil }
func (f *fakeQuerier) DeleteRecoveryCodesForUser(context.Context, string) error { return nil }

func newTestSecrets(t *testing.T) *Secrets {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-secret-do-not-use")
	t.Setenv("JWT_ALGORITHMS", "HS256")
	return NewSecrets(nil)
}

func TestRefreshRotation(t *testing.T) {
	f := newFake()
	svc := New(f, newTestSecrets(t))
	u, _ := f.CreateUser(context.Background(), CreateUserParams{ID: "u1", Email: "a@b", PasswordHash: "x", Role: "user"})
	s1, err := svc.IssueSession(context.Background(), IssueSessionInput{User: u})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := svc.Refresh(context.Background(), s1.Tokens.RefreshToken, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if s2.SessionID == s1.SessionID {
		t.Fatal("expected new session id")
	}
	if !f.sessions[s1.SessionID].RevokedAt.Valid {
		t.Fatal("old session must be revoked")
	}
	if !f.sessions[s2.SessionID].ParentSessionID.Valid || f.sessions[s2.SessionID].ParentSessionID.String != s1.SessionID {
		t.Fatal("new session must point to old as parent")
	}
}

func TestRefreshReplayRevokesChain(t *testing.T) {
	f := newFake()
	svc := New(f, newTestSecrets(t))
	u, _ := f.CreateUser(context.Background(), CreateUserParams{ID: "u1", Email: "a@b", PasswordHash: "x", Role: "user"})
	s1, _ := svc.IssueSession(context.Background(), IssueSessionInput{User: u})
	s2, _ := svc.Refresh(context.Background(), s1.Tokens.RefreshToken, "", "")
	s3, _ := svc.Refresh(context.Background(), s2.Tokens.RefreshToken, "", "")

	_, err := svc.Refresh(context.Background(), s1.Tokens.RefreshToken, "", "")
	if err == nil {
		t.Fatal("replay must fail")
	}
	var ae apperr.AppError
	if !errors.As(err, &ae) || ae.Detail != "token_replay_detected" {
		t.Fatalf("expected token_replay_detected, got %v", err)
	}
	for _, id := range []string{s1.SessionID, s2.SessionID, s3.SessionID} {
		if !f.sessions[id].RevokedAt.Valid {
			t.Fatalf("session %s must be revoked", id)
		}
	}
}

func TestRefreshExpiredSession(t *testing.T) {
	f := newFake()
	svc := New(f, newTestSecrets(t))
	u, _ := f.CreateUser(context.Background(), CreateUserParams{ID: "u1", Email: "a@b", PasswordHash: "x", Role: "user"})
	s1, _ := svc.IssueSession(context.Background(), IssueSessionInput{User: u})
	f.sessions[s1.SessionID].ExpiresAt = time.Now().Add(-time.Hour)
	if _, err := svc.Refresh(context.Background(), s1.Tokens.RefreshToken, "", ""); err == nil {
		t.Fatal("expected expired error")
	}
}
