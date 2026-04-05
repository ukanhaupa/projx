sealed class AuthState {
  const AuthState();
}

class AuthInitial extends AuthState {
  const AuthInitial();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthAuthenticated extends AuthState {
  final String accessToken;
  final String? userName;
  final String? email;
  final List<String> permissions;

  const AuthAuthenticated({
    required this.accessToken,
    this.userName,
    this.email,
    this.permissions = const [],
  });

  bool hasPermission(String permission) => permissions.contains(permission);
}

class AuthUnauthenticated extends AuthState {
  final String? reason;

  const AuthUnauthenticated({this.reason});
}

class AuthError extends AuthState {
  final String message;

  const AuthError(this.message);
}
