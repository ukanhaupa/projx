import 'package:flutter/material.dart';

class AppTypography {
  static const String fontFamily = 'Inter';
  static const String fontFamilyMono = 'JetBrains Mono';

  static const TextStyle xs = TextStyle(
    fontSize: 12,
    height: 1.5,
    fontFamily: fontFamily,
  );
  static const TextStyle sm = TextStyle(
    fontSize: 14,
    height: 1.5,
    fontFamily: fontFamily,
  );
  static const TextStyle md = TextStyle(
    fontSize: 16,
    height: 1.5,
    fontFamily: fontFamily,
  );
  static const TextStyle lg = TextStyle(
    fontSize: 18,
    height: 1.25,
    fontFamily: fontFamily,
  );
  static const TextStyle xl = TextStyle(
    fontSize: 20,
    height: 1.25,
    fontFamily: fontFamily,
  );
  static const TextStyle xxl = TextStyle(
    fontSize: 24,
    height: 1.25,
    fontFamily: fontFamily,
  );
  static const TextStyle xxxl = TextStyle(
    fontSize: 32,
    height: 1.25,
    fontFamily: fontFamily,
  );

  static TextTheme get textTheme => TextTheme(
        displayLarge: xxxl,
        displayMedium: xxl,
        headlineLarge: xxl,
        headlineMedium: xl,
        headlineSmall: lg,
        titleLarge: lg,
        titleMedium: md.copyWith(fontWeight: FontWeight.w600),
        titleSmall: sm.copyWith(fontWeight: FontWeight.w600),
        bodyLarge: md,
        bodyMedium: sm,
        bodySmall: xs,
        labelLarge: sm.copyWith(fontWeight: FontWeight.w500),
        labelMedium: xs.copyWith(fontWeight: FontWeight.w500),
        labelSmall: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          height: 1.5,
          fontFamily: fontFamily,
        ),
      );
}
