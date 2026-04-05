import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/spacing.dart';

enum ConfirmDialogVariant { primary, danger }

class ConfirmDialog {
  static Future<bool> show(
    BuildContext context, {
    required String title,
    String? description,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    ConfirmDialogVariant variant = ConfirmDialogVariant.primary,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: description != null ? Text(description) : null,
        contentPadding: const EdgeInsets.fromLTRB(
          Spacing.lg,
          Spacing.md,
          Spacing.lg,
          0,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(cancelLabel),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: variant == ConfirmDialogVariant.danger
                ? ElevatedButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                    foregroundColor: Theme.of(context).colorScheme.onError,
                  )
                : null,
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }
}
