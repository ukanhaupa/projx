import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/core/routing/routes.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/shared/widgets/confirm_dialog.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeModeProvider);
    final biometric = ref.watch(biometricAuthProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
      ),
      body: ListView(
        children: [
          const SizedBox(height: Spacing.sm),
          const _SectionHeader(title: 'Appearance'),
          SwitchListTile(
            title: const Text('Dark mode'),
            subtitle: const Text('Toggle between light and dark theme'),
            secondary: Icon(
              themeState.isDark ? Icons.dark_mode : Icons.light_mode,
            ),
            value: themeState.isDark,
            onChanged: (_) => ref.read(themeModeProvider.notifier).toggle(),
          ),
          const Divider(),
          const _SectionHeader(title: 'Security'),
          FutureBuilder<bool>(
            future: biometric.isAvailable(),
            builder: (context, snapshot) {
              final available = snapshot.data ?? false;
              if (!available) return const SizedBox.shrink();

              return SwitchListTile(
                title: const Text('Biometric authentication'),
                subtitle: const Text('Use fingerprint or face to unlock'),
                secondary: const Icon(Icons.fingerprint),
                value: biometric.isEnabled,
                onChanged: (val) async {
                  await biometric.setEnabled(val);
                  ref.invalidate(biometricAuthProvider);
                },
              );
            },
          ),
          const Divider(),
          const _SectionHeader(title: 'Account'),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('Logout'),
            onTap: () => _handleLogout(context, ref),
          ),
          const Divider(),
          const _SectionHeader(title: 'About'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('Version'),
            subtitle: Text('0.1.0'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleLogout(BuildContext context, WidgetRef ref) async {
    final confirmed = await ConfirmDialog.show(
      context,
      title: 'Logout',
      description: 'Are you sure you want to log out?',
      confirmLabel: 'Logout',
      variant: ConfirmDialogVariant.danger,
    );

    if (!confirmed || !context.mounted) return;

    final authService = ref.read(authServiceProvider);
    await authService.logout();
    ref.invalidate(authStateProvider);
    if (!context.mounted) return;
    context.go(Routes.login);
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Spacing.md,
        Spacing.md,
        Spacing.md,
        Spacing.xs,
      ),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
    );
  }
}
