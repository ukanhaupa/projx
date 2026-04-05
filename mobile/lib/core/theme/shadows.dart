import 'package:flutter/material.dart';

class AppShadows {
  static List<BoxShadow> xs(Brightness brightness) => [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: brightness == Brightness.light ? 0.05 : 0.02,
          ),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> sm(Brightness brightness) => [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: brightness == Brightness.light ? 0.1 : 0.04,
          ),
          blurRadius: 4,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> md(Brightness brightness) => [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: brightness == Brightness.light ? 0.1 : 0.06,
          ),
          blurRadius: 8,
          offset: const Offset(0, 4),
        ),
      ];

  static List<BoxShadow> lg(Brightness brightness) => [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: brightness == Brightness.light ? 0.1 : 0.08,
          ),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
      ];

  static List<BoxShadow> xl(Brightness brightness) => [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: brightness == Brightness.light ? 0.1 : 0.1,
          ),
          blurRadius: 24,
          offset: const Offset(0, 12),
        ),
      ];
}
