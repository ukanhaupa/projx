import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/color_tokens.dart';
import 'package:projx_mobile/core/theme/spacing.dart';

enum ToastType { success, error, warning, info }

class AppToast {
  static void show(
    BuildContext context, {
    required String message,
    ToastType type = ToastType.info,
    Duration duration = const Duration(seconds: 3),
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final (bgColor, iconData) = switch (type) {
      ToastType.success => (
          isDark ? ColorTokens.successBgDark : ColorTokens.successBg,
          Icons.check_circle_outline,
        ),
      ToastType.error => (
          isDark ? ColorTokens.errorBgDark : ColorTokens.errorBg,
          Icons.error_outline,
        ),
      ToastType.warning => (
          isDark ? ColorTokens.warningBgDark : ColorTokens.warningBg,
          Icons.warning_amber_outlined,
        ),
      ToastType.info => (
          isDark ? ColorTokens.infoBgDark : ColorTokens.infoBg,
          Icons.info_outline,
        ),
    };

    final textColor = switch (type) {
      ToastType.success =>
        isDark ? ColorTokens.successTextDark : ColorTokens.successText,
      ToastType.error =>
        isDark ? ColorTokens.errorTextDark : ColorTokens.errorText,
      ToastType.warning =>
        isDark ? ColorTokens.warningTextDark : ColorTokens.warningText,
      ToastType.info => isDark
          ? ColorTokens.accentPrimaryTextDark
          : ColorTokens.accentPrimaryText,
    };

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(iconData, color: textColor, size: 20),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(message, style: TextStyle(color: textColor)),
            ),
          ],
        ),
        backgroundColor: bgColor,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusMd),
        duration: duration,
      ),
    );
  }
}
