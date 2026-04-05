// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Project Template';

  @override
  String get dashboard => 'Dashboard';

  @override
  String get settings => 'Settings';

  @override
  String get login => 'Login';

  @override
  String get logout => 'Logout';

  @override
  String get logoutConfirm => 'Are you sure you want to log out?';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get save => 'Save';

  @override
  String get delete => 'Delete';

  @override
  String get edit => 'Edit';

  @override
  String get create => 'Create';

  @override
  String get search => 'Search...';

  @override
  String get filter => 'Filter';

  @override
  String get sort => 'Sort';

  @override
  String get retry => 'Retry';

  @override
  String get refresh => 'Refresh';

  @override
  String get loading => 'Loading...';

  @override
  String get noItems => 'No items yet';

  @override
  String get noItemsDescription =>
      'Tap the + button to create your first item.';

  @override
  String get errorGeneric => 'Something went wrong';

  @override
  String get errorNetwork => 'No internet connection';

  @override
  String get errorSessionExpired => 'Session expired. Please log in again.';

  @override
  String get errorPermission => 'You don\'t have permission to do this.';

  @override
  String get errorNotFound => 'Item not found';

  @override
  String get errorConflict => 'This item already exists';

  @override
  String get errorValidation => 'Validation failed';

  @override
  String get errorTooMany => 'Too many requests. Please wait a moment.';

  @override
  String get deleteConfirm => 'Are you sure you want to delete this item?';

  @override
  String get deleteConfirmDescription => 'This action cannot be undone.';

  @override
  String get unsavedChanges => 'You have unsaved changes';

  @override
  String get unsavedChangesDescription => 'Discard your changes?';

  @override
  String get discard => 'Discard';

  @override
  String get offlineBanner => 'You\'re offline';

  @override
  String pendingSync(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count changes pending sync',
      one: '1 change pending sync',
    );
    return '$_temp0';
  }

  @override
  String get syncing => 'Syncing...';

  @override
  String get syncComplete => 'All changes synced';

  @override
  String get darkMode => 'Dark mode';

  @override
  String get biometricAuth => 'Biometric authentication';

  @override
  String get createdAt => 'Created';

  @override
  String get updatedAt => 'Updated';

  @override
  String showingResults(int start, int end, int total) {
    return 'Showing $start-$end of $total';
  }

  @override
  String get fullCrud => 'Full CRUD';

  @override
  String get readOnly => 'Read Only';

  @override
  String get requiredField => 'This field is required';

  @override
  String get invalidEmail => 'Invalid email format';

  @override
  String get invalidNumber => 'Please enter a valid number';
}
