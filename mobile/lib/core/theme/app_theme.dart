import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/color_tokens.dart';
import 'package:projx_mobile/core/theme/spacing.dart';
import 'package:projx_mobile/core/theme/typography.dart';

class AppTheme {
  static ThemeData light() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: ColorTokens.accentPrimary,
      brightness: Brightness.light,
    ).copyWith(
      primary: ColorTokens.accentPrimary,
      onPrimary: ColorTokens.accentText,
      secondary: ColorTokens.accentSubtle,
      onSecondary: ColorTokens.accentPrimaryText,
      surface: ColorTokens.bgSecondary,
      onSurface: ColorTokens.textPrimary,
      surfaceContainerHighest: ColorTokens.bgPrimary,
      error: ColorTokens.error,
      onError: ColorTokens.textInverse,
      outline: ColorTokens.borderDefault,
      outlineVariant: ColorTokens.borderSubtle,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: ColorTokens.bgPrimary,
      textTheme: AppTypography.textTheme.apply(
        bodyColor: ColorTokens.textPrimary,
        displayColor: ColorTokens.textPrimary,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: ColorTokens.bgSecondary,
        foregroundColor: ColorTokens.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 1,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: ColorTokens.bgSecondary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: Spacing.borderRadiusLg,
          side: const BorderSide(color: ColorTokens.borderDefault),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ColorTokens.inputBg,
        border: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.inputBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.inputBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(
            color: ColorTokens.borderFocus,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.borderError),
        ),
        hintStyle: AppTypography.sm.copyWith(
          color: ColorTokens.inputPlaceholder,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.sm + 4,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorTokens.accentPrimary,
          foregroundColor: ColorTokens.accentText,
          shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusSm),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm + 4,
          ),
          textStyle: AppTypography.sm.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ColorTokens.textPrimary,
          side: const BorderSide(color: ColorTokens.borderDefault),
          shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusSm),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm + 4,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: ColorTokens.accentPrimary),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: ColorTokens.accentPrimary,
        foregroundColor: ColorTokens.accentText,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusLg),
      ),
      dividerTheme: const DividerThemeData(
        color: ColorTokens.borderDefault,
        thickness: 1,
        space: 0,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: ColorTokens.bgSecondary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(Spacing.radiusLg),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: ColorTokens.bgSecondary,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusLg),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusMd),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusFull),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: ColorTokens.bgSecondary,
        indicatorColor: ColorTokens.accentSubtle,
        surfaceTintColor: Colors.transparent,
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: ColorTokens.sidebarBg,
      ),
      listTileTheme: ListTileThemeData(
        contentPadding: Spacing.listItemPadding,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusMd),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ColorTokens.accentPrimary;
          }
          return ColorTokens.borderDefault;
        }),
      ),
    );
  }

  static ThemeData dark() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: ColorTokens.accentPrimaryDark,
      brightness: Brightness.dark,
    ).copyWith(
      primary: ColorTokens.accentPrimaryDark,
      onPrimary: ColorTokens.accentTextDark,
      secondary: ColorTokens.accentSubtleDark,
      onSecondary: ColorTokens.accentPrimaryTextDark,
      surface: ColorTokens.bgSecondaryDark,
      onSurface: ColorTokens.textPrimaryDark,
      surfaceContainerHighest: ColorTokens.bgPrimaryDark,
      error: ColorTokens.errorDark,
      onError: ColorTokens.textInverseDark,
      outline: ColorTokens.borderDefaultDark,
      outlineVariant: ColorTokens.borderSubtleDark,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: ColorTokens.bgPrimaryDark,
      textTheme: AppTypography.textTheme.apply(
        bodyColor: ColorTokens.textPrimaryDark,
        displayColor: ColorTokens.textPrimaryDark,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: ColorTokens.bgSecondaryDark,
        foregroundColor: ColorTokens.textPrimaryDark,
        elevation: 0,
        scrolledUnderElevation: 1,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: ColorTokens.bgSecondaryDark,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: Spacing.borderRadiusLg,
          side: const BorderSide(color: ColorTokens.borderDefaultDark),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ColorTokens.inputBgDark,
        border: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.inputBorderDark),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.inputBorderDark),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(
            color: ColorTokens.borderFocusDark,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: Spacing.borderRadiusSm,
          borderSide: const BorderSide(color: ColorTokens.borderErrorDark),
        ),
        hintStyle: AppTypography.sm.copyWith(
          color: ColorTokens.inputPlaceholderDark,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.sm + 4,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorTokens.accentPrimaryDark,
          foregroundColor: ColorTokens.accentTextDark,
          shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusSm),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm + 4,
          ),
          textStyle: AppTypography.sm.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ColorTokens.textPrimaryDark,
          side: const BorderSide(color: ColorTokens.borderDefaultDark),
          shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusSm),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm + 4,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ColorTokens.accentPrimaryDark,
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: ColorTokens.accentPrimaryDark,
        foregroundColor: ColorTokens.accentTextDark,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusLg),
      ),
      dividerTheme: const DividerThemeData(
        color: ColorTokens.borderDefaultDark,
        thickness: 1,
        space: 0,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: ColorTokens.bgSecondaryDark,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(Spacing.radiusLg),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: ColorTokens.bgSecondaryDark,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusLg),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusMd),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusFull),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: ColorTokens.bgSecondaryDark,
        indicatorColor: ColorTokens.accentSubtleDark,
        surfaceTintColor: Colors.transparent,
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: ColorTokens.sidebarBgDark,
      ),
      listTileTheme: ListTileThemeData(
        contentPadding: Spacing.listItemPadding,
        shape: RoundedRectangleBorder(borderRadius: Spacing.borderRadiusMd),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ColorTokens.accentPrimaryDark;
          }
          return ColorTokens.borderDefaultDark;
        }),
      ),
    );
  }
}

class AppDurations {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 400);
}

class AppLayout {
  static const double drawerWidth = 260.0;
  static const double appBarHeight = 56.0;
  static const double contentMaxWidth = 1200.0;
  static const double formMaxWidth = 640.0;
}

class Breakpoints {
  static const double sm = 640;
  static const double md = 768;
  static const double lg = 1024;
  static const double xl = 1280;

  static bool isPhone(BuildContext context) =>
      MediaQuery.sizeOf(context).width < md;

  static bool isTablet(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return width >= md && width < lg;
  }

  static bool isDesktop(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= lg;
}
