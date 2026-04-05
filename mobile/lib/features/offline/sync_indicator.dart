import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:projx_mobile/core/providers/core_providers.dart';
import 'package:projx_mobile/core/theme/color_tokens.dart';
import 'package:projx_mobile/core/theme/spacing.dart';

class SyncIndicator extends ConsumerWidget {
  const SyncIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOnline = ref.watch(isOnlineProvider);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (isOnline) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.sm,
      ),
      color: isDark ? ColorTokens.warningBgDark : ColorTokens.warningBg,
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            Icon(
              Icons.cloud_off,
              size: 16,
              color: isDark
                  ? ColorTokens.warningTextDark
                  : ColorTokens.warningText,
            ),
            const SizedBox(width: Spacing.sm),
            Text(
              'You\'re offline',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: isDark
                    ? ColorTokens.warningTextDark
                    : ColorTokens.warningText,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
