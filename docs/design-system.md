# Projx — Design System

---

## Overview

This document defines the complete UI/UX design system for Projx. It is the single source of truth for visual design, interaction patterns, component specs, and screen layouts across all frontend stacks: **React (SPA + SSR/SSG)** and **Flutter Mobile**.

The React SPA implementation (`frontend/`) serves as the reference implementation. All other frontends must achieve visual and behavioral parity with this system.

---

## 1. Design Principles

1. **Clarity over decoration** — Every element earns its place. No ornamental gradients, no decorative animations.
2. **Token-driven** — Zero hardcoded values. Colors, spacing, typography, shadows — everything flows from tokens.
3. **Theme-native** — Light and dark themes are first-class citizens, not afterthoughts.
4. **Mobile-first** — Design for 320px, enhance for 1440px.
5. **State-complete** — Every screen has loading, empty, error, success, and forbidden states designed.
6. **Accessible** — WCAG 2.1 AA minimum. Color is never the only indicator.
7. **Auto-generated** — The design system powers dynamic entity UI from backend metadata. Components must work with unknown data shapes.

---

## 2. Design Token System

Tokens are the atomic design values. All implementations reference tokens — never raw values.

### 2.1 Color Tokens

#### Backgrounds

| Token                     | Light             | Dark              | Usage                     |
| ------------------------- | ----------------- | ----------------- | ------------------------- |
| `--color-bg`              | `#f8f9fa`         | `#0f1117`         | Page background           |
| `--color-surface`         | `#ffffff`         | `#1a1d27`         | Cards, modals, panels     |
| `--color-surface-raised`  | `#ffffff`         | `#22252f`         | Hovered/elevated surfaces |
| `--color-surface-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | Modal backdrop            |

#### Text

| Token                    | Light     | Dark      | Usage                       |
| ------------------------ | --------- | --------- | --------------------------- |
| `--color-text`           | `#1a202c` | `#e2e8f0` | Primary body text           |
| `--color-text-secondary` | `#4a5568` | `#a0aec0` | Labels, descriptions        |
| `--color-text-muted`     | `#718096` | `#64748b` | Help text, hints            |
| `--color-text-inverse`   | `#ffffff` | `#1a202c` | Text on colored backgrounds |

#### Borders

| Token                  | Light                  | Dark                   | Usage           |
| ---------------------- | ---------------------- | ---------------------- | --------------- |
| `--color-border`       | `#e2e8f0`              | `#2d3748`              | Default borders  |
| `--color-border-hover` | `#cbd5e1`              | `#4a5568`              | Hovered borders  |
| `--color-border-focus` | `var(--color-primary)` | `var(--color-primary)` | Focused inputs  |

#### Brand / Accent

| Token                   | Light     | Dark      | Usage                                           |
| ----------------------- | --------- | --------- | ----------------------------------------------- |
| `--color-primary`       | `#2563eb` | `#3b82f6` | Primary actions, links                           |
| `--color-primary-hover` | `#1d4ed8` | `#2563eb` | Primary hover state                              |
| `--color-primary-light` | `#dbeafe` | `#1e3a5f` | Primary background tint (badges, highlights)     |
| `--color-primary-text`  | `#1e40af` | `#93c5fd` | Readable text on `--color-primary-light` bg      |

#### Semantic

| Token                   | Light     | Dark      | Usage                        |
| ----------------------- | --------- | --------- | ---------------------------- |
| `--color-success`       | `#16a34a` | `#22c55e` | Success states                              |
| `--color-success-hover` | `#15803d` | `#16a34a` | Success hover                               |
| `--color-success-light` | `#dcfce7` | `#14332a` | Success background (badges, alerts)         |
| `--color-success-text`  | `#166534` | `#86efac` | Readable text on `--color-success-light` bg |
| `--color-warning`       | `#d97706` | `#f59e0b` | Warning states                              |
| `--color-warning-hover` | `#b45309` | `#d97706` | Warning hover                               |
| `--color-warning-light` | `#fef3c7` | `#332b14` | Warning background (badges, alerts)         |
| `--color-warning-text`  | `#92400e` | `#fcd34d` | Readable text on `--color-warning-light` bg |
| `--color-danger`        | `#dc2626` | `#ef4444` | Danger/error states                         |
| `--color-danger-hover`  | `#b91c1c` | `#dc2626` | Danger hover                                |
| `--color-danger-light`  | `#fee2e2` | `#3b1515` | Danger background (badges, alerts)          |
| `--color-danger-text`   | `#991b1b` | `#fca5a5` | Readable text on `--color-danger-light` bg  |
| `--color-info`          | `#2563eb` | `#3b82f6` | Informational states                        |
| `--color-info-hover`    | `#1d4ed8` | `#2563eb` | Info hover                                  |
| `--color-info-light`    | `#dbeafe` | `#1e3a5f` | Info background (badges, alerts)            |
| `--color-info-text`     | `#1e40af` | `#93c5fd` | Readable text on `--color-info-light` bg    |

> **Token naming convention**: The `--color-{semantic}-text` tokens provide readable text colors for use on the corresponding `--color-{semantic}-light` tinted backgrounds (badges, alerts, status indicators). For buttons on solid colored backgrounds (e.g., `--color-primary`, `--color-danger`), use `#ffffff` directly -- these solid colors already guarantee WCAG AA contrast against white.

#### Sidebar

| Token                         | Light                    | Dark                     | Usage              |
| ----------------------------- | ------------------------ | ------------------------ | ------------------ |
| `--color-sidebar-bg`          | `#111827`                | `#0a0c14`               | Sidebar background |
| `--color-sidebar-text`        | `#d1d5db`                | `#94a3b8`                | Sidebar text       |
| `--color-sidebar-text-active` | `#ffffff`                | `#ffffff`                | Active nav text    |
| `--color-sidebar-hover`       | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.06)` | Nav hover bg       |
| `--color-sidebar-active`      | `rgba(255,255,255,0.12)` | `rgba(255,255,255,0.10)` | Active nav bg      |
| `--color-sidebar-border`      | `#1f2937`                | `#1a1d27`                | Sidebar border     |

#### Table

| Token                | Light     | Dark      | Usage            |
| -------------------- | --------- | --------- | ---------------- |
| `--color-th-bg`      | `#f8fafc` | `#1e2130` | Table header bg  |
| `--color-row-hover`  | `#f1f5f9` | `#22252f` | Row hover        |
| `--color-row-stripe` | `#fafbfc` | `#1c1f29` | Alternating rows |

#### Form Inputs

| Token                       | Light                  | Dark                   | Usage              |
| --------------------------- | ---------------------- | ---------------------- | ------------------ |
| `--color-input-bg`          | `#ffffff`              | `#1e2130`              | Input background   |
| `--color-input-border`      | `#e2e8f0`              | `#2d3748`              | Input border       |
| `--color-input-focus`       | `var(--color-primary)` | `var(--color-primary)` | Focus border color |
| `--color-input-placeholder` | `#a0aec0`              | `#4a5568`              | Placeholder text   |

#### Focus Ring

| Token          | Value                 | Usage               |
| -------------- | --------------------- | ------------------- |
| `--ring-color` | `rgba(37,99,235,0.3)` | Focus outline color |
| `--ring-width` | `3px`                 | Focus outline width |

### 2.2 Typography Tokens

| Token               | Value              | Usage                  |
| ------------------- | ------------------ | ---------------------- |
| `--text-xs`         | `0.75rem` (12px)   | Badges, captions       |
| `--text-sm`         | `0.8125rem` (13px) | Help text, table cells |
| `--text-base`       | `0.875rem` (14px)  | Body text, inputs      |
| `--text-md`         | `1rem` (16px)      | Subheadings            |
| `--text-lg`         | `1.125rem` (18px)  | Section titles         |
| `--text-xl`         | `1.25rem` (20px)   | Page titles            |
| `--text-2xl`        | `1.5rem` (24px)    | Hero/landing headings  |
| `--font-normal`     | `400`              | Body text              |
| `--font-medium`     | `500`              | Labels, nav items      |
| `--font-semibold`   | `600`              | Subheadings, buttons   |
| `--font-bold`       | `700`              | Page titles            |
| `--leading-tight`   | `1.25`             | Headings               |
| `--leading-normal`  | `1.5`              | Body text              |
| `--leading-relaxed` | `1.75`             | Long-form content      |

| `--font-sans` | `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Body text font stack |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', monospace` | Code, technical values |

**Flutter Equivalent**: Use `Inter` via Google Fonts package. Map tokens to `TextTheme` values.

### 2.3 Spacing Tokens

| Token        | Value            | Usage                       |
| ------------ | ---------------- | --------------------------- |
| `--space-0`  | `0`              | Reset                       |
| `--space-1`  | `0.25rem` (4px)  | Tight inline spacing        |
| `--space-2`  | `0.5rem` (8px)   | Icon gaps, compact padding  |
| `--space-3`  | `0.75rem` (12px) | Form field gap              |
| `--space-4`  | `1rem` (16px)    | Standard padding, card body |
| `--space-5`  | `1.25rem` (20px) | Section spacing             |
| `--space-6`  | `1.5rem` (24px)  | Card padding, group gap     |
| `--space-8`  | `2rem` (32px)    | Section gap                 |
| `--space-10` | `2.5rem` (40px)  | Page section gap            |
| `--space-12` | `3rem` (48px)    | Major section dividers      |

### 2.4 Border Radius Tokens

| Token           | Value    | Usage                  |
| --------------- | -------- | ---------------------- |
| `--radius-sm`   | `4px`    | Inputs, small elements |
| `--radius-md`   | `6px`    | Buttons, cards         |
| `--radius-lg`   | `8px`    | Modals, larger panels  |
| `--radius-xl`   | `12px`   | Feature cards          |
| `--radius-full` | `9999px` | Badges, avatars, pills |

### 2.5 Shadow Tokens

| Token         | Light                                                          | Dark                              | Usage               |
| ------------- | -------------------------------------------------------------- | --------------------------------- | ------------------- |
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.05)`                                  | `0 1px 2px rgba(0,0,0,0.2)`      | Subtle depth        |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)`      | `0 1px 3px rgba(0,0,0,0.3)`      | Cards at rest       |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06)`      | `0 4px 6px rgba(0,0,0,0.3)`      | Dropdowns, popovers |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)`    | `0 10px 15px rgba(0,0,0,0.35)`   | Modals              |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)`  | `0 20px 25px rgba(0,0,0,0.4)`    | Floating panels     |

**Dark theme**: Shadows use higher opacity but simpler structure since dark surfaces already use elevation via background lightness.

### 2.6 Transition Tokens

| Token               | Value       | Usage                     |
| ------------------- | ----------- | ------------------------- |
| `--transition-fast` | `0.1s ease` | Hover, focus states       |
| `--transition-base` | `0.2s ease` | Toggles, color changes    |
| `--transition-slow` | `0.3s ease` | Sidebar collapse, drawers |

### 2.7 Layout Tokens

| Token                   | Value    | Usage                   |
| ----------------------- | -------- | ----------------------- |
| `--sidebar-w`           | `240px`  | Sidebar expanded width  |
| `--sidebar-collapsed-w` | `56px`   | Sidebar collapsed width |
| `--header-h`            | `56px`   | Header height           |
| `--content-max-w`       | `1200px` | Content area max width  |
| `--form-max-w`          | `640px`  | Form max width          |

### 2.8 Breakpoints

| Name  | Value    | Target           |
| ----- | -------- | ---------------- |
| `sm`  | `640px`  | Mobile landscape |
| `md`  | `768px`  | Tablet           |
| `lg`  | `1024px` | Small desktop    |
| `xl`  | `1280px` | Desktop          |
| `2xl` | `1536px` | Wide desktop     |

### 2.9 Z-Index Scale

| Token          | Value | Usage                    |
| -------------- | ----- | ------------------------ |
| `--z-dropdown` | `100` | Dropdowns, popovers      |
| `--z-sticky`   | `200` | Sticky headers           |
| `--z-sidebar`  | `300` | Sidebar overlay (mobile) |
| `--z-modal`    | `400` | Modals, dialogs          |
| `--z-toast`    | `500` | Toast notifications      |
| `--z-tooltip`  | `600` | Tooltips                 |

---

## 3. Cross-Platform Token Mapping

### CSS (React — SPA + SSR/SSG)

Tokens defined as CSS custom properties in `index.css`. Theme switching via `[data-theme='dark']` on `<html>`.

### Flutter

Tokens mapped to a `AppTheme` class:

```dart
class AppTheme {
  // Generate ThemeData from tokens
  static ThemeData light() => ThemeData(
    colorScheme: ColorScheme.light(
      primary: Color(0xFF2563EB),       // --color-primary
      surface: Color(0xFFFFFFFF),       // --color-surface
      background: Color(0xFFF8F9FA),    // --color-bg
      error: Color(0xFFDC2626),         // --color-danger
    ),
    textTheme: TextTheme(
      bodySmall: TextStyle(fontSize: 12),   // --text-xs
      bodyMedium: TextStyle(fontSize: 14),  // --text-base
      titleMedium: TextStyle(fontSize: 16), // --text-md
      titleLarge: TextStyle(fontSize: 20),  // --text-xl
      headlineMedium: TextStyle(fontSize: 24), // --text-2xl
    ),
    // ... spacing via AppSpacing extension
  );

  static ThemeData dark() => ThemeData(
    colorScheme: ColorScheme.dark(
      primary: Color(0xFF3B82F6),
      surface: Color(0xFF1A1D27),
      background: Color(0xFF0F1117),
      error: Color(0xFFEF4444),
    ),
    // ...
  );
}
```

Spacing and radius use a custom extension on `ThemeData` since Flutter lacks native CSS variable equivalents.

---

## 4. Layout System

### 4.1 Page Shell

```
+----------------------------------------------------------+
| [=] Logo / App Name          [Theme] [User ▾]           |  <- Header (56px, mobile only shows hamburger)
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Breadcrumb: Home > Entities > Users          |
| (240px)  |                                               |
|          |  Page Title              [+ Create]           |
| [■] Dash |                                               |
| [▣] Users|  +-------------------------------------------+|
| [▣] Roles|  | Content Area (max 1200px, centered)       ||
| [▣] Logs |  |                                           ||
|          |  |                                           ||
|          |  +-------------------------------------------+|
|          |                                               |
+----------+  Footer: Pagination / Actions                 |
| User     |                                               |
| [Logout] +-----------------------------------------------+
+----------+
```

### 4.2 Sidebar

**Expanded** (240px):

- Logo/app name at top (with collapse toggle)
- Navigation links with icons + labels
- Active link: highlighted bg + white text + left accent border (3px)
- Hover: subtle bg change
- Footer: user name + email + logout button

**Collapsed** (56px, desktop only):

- Icon-only navigation
- Tooltip on hover showing label
- Logo collapses to icon

**Mobile** (<768px):

- Sidebar hidden by default
- Hamburger button (top-left, fixed)
- Sidebar slides in as overlay (left-to-right, 300ms)
- Backdrop overlay behind sidebar
- Close on backdrop click or X button

### 4.3 Responsive Behavior

| Breakpoint   | Sidebar                | Content           | Notes             |
| ------------ | ---------------------- | ----------------- | ----------------- |
| < 768px      | Hidden (overlay)       | Full width        | Hamburger menu    |
| 768px–1023px | Collapsed (56px icons) | Margin left 56px  | Auto-collapse     |
| >= 1024px    | Expanded (240px)       | Margin left 240px | User can collapse |

---

## 5. Screen Specifications

### 5.1 Dashboard

**Purpose**: Landing page showing all available entities as navigable cards.

**Layout**:

```
+------------------------------------------+
| Dashboard                                |
|                                          |
| +--------+ +--------+ +--------+        |
| | Users  | | Roles  | | Logs   |        |
| | ▣      | | ▣      | | ▢      |        |
| | Full   | | Full   | | Read   |        |
| | CRUD   | | CRUD   | | Only   |        |
| +--------+ +--------+ +--------+        |
|                                          |
| +--------+ +--------+                   |
| | Tasks  | | Config |                   |
| | ▣      | | ▣      |                   |
| | Full   | | Full   |                   |
| | CRUD   | | CRUD   |                   |
| +--------+ +--------+                   |
+------------------------------------------+
```

**Card Spec**:

- Min width: 220px, auto-fill grid
- Background: `--color-surface`
- Border: `1px solid var(--color-border)`
- Radius: `--radius-lg`
- Padding: `--space-6`
- Hover: shadow increase (`--shadow-md`), border color change
- Icon: entity icon (filled = writable, outline = read-only)
- Title: entity name (`--text-md`, `--font-semibold`)
- Subtitle: "Full CRUD" or "Read Only" (`--text-xs`, `--color-text-muted`)

**States**:

- Loading: 6 skeleton cards (shimmer animation)
- Empty: "No entities configured" message with docs link
- Error: Error message with retry button

### 5.2 Entity List View

**Purpose**: Auto-generated data table for any entity, with search, filter, sort, and pagination.

**Layout**:

```
+---------------------------------------------------+
| Users                              [+ Create User] |
|                                                     |
| [🔍 Search users...]  [⚙ Filters (3)]             |
|                                                     |
| +- Filter Panel (collapsible) -------------------+ |
| | Name: [________]  Email: [________]            | |
| | Role: [________]  Status: [________]           | |
| |                            [Clear all filters] | |
| +------------------------------------------------+ |
|                                                     |
| +------------------------------------------------+ |
| | □  Name ↕     | Email ↕    | Role  | Actions  | |
| |------------------------------------------------| |
| | □  John Doe   | john@...   | Admin | [✎] [🗑] | |
| | □  Jane Smith | jane@...   | User  | [✎] [🗑] | |
| | □  Bob Wilson | bob@...    | User  | [✎] [🗑] | |
| |                                                | |
| +------------------------------------------------+ |
|                                                     |
| Showing 1-10 of 47        [< Prev]  Page 1  [Next >]|
+---------------------------------------------------+
```

**Toolbar**:

- Search input: full width on mobile, 300px on desktop
- Debounced 400ms
- Filter toggle button with active filter count badge
- Create button: primary variant, right-aligned

**Filter Panel**:

- Collapsible (slide down, 200ms)
- Grid layout: 2 columns on desktop, 1 on mobile
- One input per filterable column
- "Clear all filters" link (appears when any filter active)

**Table**:

- Sticky header row
- Horizontal scroll on mobile (with scroll shadow indicators)
- Sortable columns: click header to toggle asc/desc, icon shows direction
- Row hover highlight
- Alternating row stripes (subtle)
- Checkbox column for bulk selection (future)
- Actions column: Edit (pencil icon) + Delete (trash icon)
- Action buttons: ghost style, icon-only on mobile, icon+text on desktop

**Pagination**:

- Bottom of table
- Shows: "Showing X-Y of Z"
- Prev/Next buttons (disabled at bounds)
- Current page indicator
- Page size selector: 10, 25, 50 (dropdown)

**States**:

- Loading: Skeleton table (header + 5 shimmer rows)
- Empty (no data): Illustration + "No [entities] yet" + Create button
- Empty (filtered): "No results match your filters" + Clear filters button
- Error: Error message in card + Retry button
- Forbidden: "You don't have permission to view [entity]" + Back to Dashboard link

### 5.3 Entity Detail View (Future Enhancement)

**Purpose**: Full detail view of a single entity record. Currently handled by edit modal; planned as dedicated page.

**Layout**:

```
+---------------------------------------------------+
| ← Back to Users                                    |
|                                                     |
| John Doe                          [Edit] [Delete]  |
| Created: Jan 15, 2026                              |
|                                                     |
| +- Details ---------------------+                  |
| | Name        John Doe          |                  |
| | Email       john@example.com  |                  |
| | Role        Admin             |                  |
| | Status      ● Active          |                  |
| | Last Login  2 hours ago       |                  |
| +-------------------------------+                  |
|                                                     |
| +- Related Entities (if FK) ----+                  |
| | Tasks (5)        [View all →] |                  |
| | - Fix login bug    In Progress|                  |
| | - Update docs      Done       |                  |
| | - Review PR #42    Pending    |                  |
| +-------------------------------+                  |
+---------------------------------------------------+
```

**Spec**:

- Back link with left arrow
- Entity name as page title
- Metadata (created, updated) below title in muted text
- Detail card: key-value pairs in 2-column grid (1 on mobile)
- Related entities: linked cards if FK relationships exist
- Action buttons: Edit (primary) + Delete (danger ghost)

### 5.4 Entity Create/Edit Form (Modal)

**Purpose**: Auto-generated form from backend field metadata. Opens as modal overlay.

**Layout**:

```
+------------------------------------------+
|  Create User                         [X] |
|                                          |
|  Name *                                  |
|  [John Doe________________________]      |
|                                          |
|  Email *                                 |
|  [john@example.com________________]      |
|  Must be a valid email address           |
|                                          |
|  Role                                    |
|  [▾ Select role___________________]      |
|                                          |
|  Bio                                     |
|  [________________________________]      |
|  [________________________________]      |
|  [________________________________]      |
|                                          |
|  Active                                  |
|  [✓] Enable this user                   |
|                                          |
|           [Cancel]  [Create User]        |
+------------------------------------------+
```

**Modal Spec**:

- Width: 480px (desktop), 90vw (mobile), max 640px for complex forms
- Centered vertically with slight upward offset
- Backdrop: `--color-surface-overlay`, click does NOT dismiss (prevents data loss)
- Escape key: dismisses (same as Cancel)
- Border radius: `--radius-lg`
- Shadow: `--shadow-lg`
- Animation: fade backdrop (150ms) + scale content 0.95→1.0 (200ms)

**Field Types & Rendering**:

| Type       | Component       | Notes                               |
| ---------- | --------------- | ----------------------------------- |
| `text`     | Text input      | Standard single-line                |
| `number`   | Number input    | Step attribute from metadata        |
| `date`     | Date picker     | Native `input[type=date]`           |
| `datetime` | Datetime picker | Native `input[type=datetime-local]` |
| `textarea` | Textarea        | 3 rows default, auto-expand         |
| `select`   | Select dropdown | Options from metadata               |
| `boolean`  | Checkbox        | Label beside checkbox               |

**Field Anatomy**:

```
Label *                          <- Label (--text-sm, --font-medium)
[Input value___________________] <- Input (--text-base, --radius-sm)
Help text or validation error    <- Helper (--text-xs, --color-text-muted or --color-danger)
```

**Validation**:

- Required fields: asterisk (\*) after label
- Validate on blur (not keystroke)
- Error state: red border + red helper text + field shakes briefly
- Server errors: parse and map to fields, fallback to form-level error
- Submit disabled while form is clean (no changes) or saving

**Buttons**:

- Cancel: ghost/text style, left
- Submit: primary filled, right
- Submit label: specific verb ("Create User", "Save Changes"), not generic ("Submit")
- Loading state: spinner + "Creating..." / "Saving..."

### 5.5 Auth Screens

#### Login

```
+------------------------------------------+
|                              [☾ Theme]   |
|                                          |
|          +--------------------+          |
|          |   [Logo]           |          |
|          |   App Name         |          |
|          |                    |          |
|          |   Username         |          |
|          |   [______________] |          |
|          |                    |          |
|          |   Password         |          |
|          |   [__________] [👁] |         |
|          |                    |          |
|          |   [  Sign In  ]   |          |
|          |                    |          |
|          |   Forgot password? |          |
|          +--------------------+          |
|                                          |
+------------------------------------------+
```

**Spec**:

- Centered card (max 400px)
- Background: page bg with subtle pattern or gradient (optional)
- Logo + app name at top
- Username and password inputs
- Password visibility toggle (eye icon)
- Primary submit button, full width
- "Forgot password?" link below button
- Error display: inline above form, red card with error message
- Loading: button shows spinner + "Signing in..."
- Theme toggle in top-right corner

#### Register (If enabled)

Same layout as login with additional fields:

- Full name
- Email
- Password + Confirm password
- Terms checkbox
- "Already have an account? Sign in" link

#### Forgot Password

- Email input only
- "Send Reset Link" button
- Success state: "Check your email" message
- Back to login link

#### Reset Password

- New password + Confirm password
- Password strength indicator (bar: weak/fair/strong)
- "Reset Password" button
- Auto-redirect to login on success

### 5.6 Settings / Profile Page

```
+---------------------------------------------------+
| Settings                                            |
|                                                     |
| +- Profile ----------------------+                 |
| | [Avatar]  John Doe             |                 |
| |           john@example.com     |                 |
| |           Admin                |                 |
| |                   [Edit Profile]|                 |
| +--------------------------------+                 |
|                                                     |
| +- Appearance --------------------+                |
| | Theme     [Light ▾]            |                 |
| | Language  [English ▾]          |                 |
| +--------------------------------+                 |
|                                                     |
| +- Security ----------------------+                |
| | Change Password                 |                |
| | [Current password_________]     |                |
| | [New password_____________]     |                |
| | [Confirm password_________]     |                |
| |               [Update Password] |                |
| +--------------------------------+                 |
+---------------------------------------------------+
```

**Sections**:

- Profile: avatar, name, email, role (from Keycloak)
- Appearance: theme selector, language (if i18n enabled)
- Security: change password form
- Each section in a card with heading

### 5.7 Error Pages

#### 404 — Not Found

```
+------------------------------------------+
|                                          |
|              404                         |
|                                          |
|     Page not found                       |
|                                          |
|     The page you're looking for          |
|     doesn't exist or has been moved.     |
|                                          |
|     [← Back to Dashboard]               |
|                                          |
+------------------------------------------+
```

- Large "404" in `--text-2xl`, `--font-bold`, `--color-text-muted`
- Subtitle in `--color-text-secondary`
- Single CTA button back to dashboard

#### 500 — Server Error

```
+------------------------------------------+
|                                          |
|           Something went wrong           |
|                                          |
|     We're having trouble loading         |
|     this page. Please try again.         |
|                                          |
|     [Retry]  [Back to Dashboard]         |
|                                          |
+------------------------------------------+
```

- No error code shown to user (avoid exposing internals)
- Retry button (primary) + Dashboard link (ghost)
- Auto-retry for network errors (3 attempts, exponential backoff)

#### 403 — Forbidden

```
+------------------------------------------+
|                                          |
|           Access Denied                  |
|                                          |
|     You don't have permission to         |
|     view this page.                      |
|                                          |
|     [← Back to Dashboard]               |
|                                          |
+------------------------------------------+
```

---

## 6. Component Specifications

### 6.1 Button

**Variants**:

| Variant      | Background        | Text              | Border           | Usage                       |
| ------------ | ----------------- | ----------------- | ---------------- | --------------------------- |
| Primary      | `--color-primary` | white             | none             | Main actions (Create, Save) |
| Secondary    | `--color-surface` | `--color-text`    | `--color-border` | Secondary actions           |
| Ghost        | transparent       | `--color-primary` | none             | Tertiary actions, cancel    |
| Danger       | `--color-danger`  | white             | none             | Destructive actions         |
| Danger Ghost | transparent       | `--color-danger`  | none             | Inline delete               |

**Sizes**:

| Size | Height | Padding                 | Font          |
| ---- | ------ | ----------------------- | ------------- |
| sm   | 32px   | `--space-2` `--space-3` | `--text-sm`   |
| md   | 36px   | `--space-2` `--space-4` | `--text-base` |
| lg   | 44px   | `--space-3` `--space-6` | `--text-md`   |

**States**: default, hover, active (scale 0.98), focus (ring), disabled (opacity 0.5), loading (spinner + text)

**Rules**:

- Always use specific verb labels: "Create User", "Save Changes", "Delete Project"
- Never "OK", "Yes", "Submit"
- Icon + text or icon-only (with aria-label)
- Full-width option for mobile forms

### 6.2 Input

**Anatomy**:

```
Label *                                   <- --text-sm, --font-medium
[Placeholder text________________________] <- 36px height, --radius-sm
Helper text                               <- --text-xs, --color-text-muted
```

**States**:

- Default: `--color-input-border`
- Hover: `--color-border-hover`
- Focus: `--color-input-focus` border + `--ring-color` ring
- Error: `--color-danger` border + red helper text
- Disabled: `--color-bg` background, 0.5 opacity

**Variants**: text, email, password (with toggle), number, search (with icon), textarea

### 6.3 Select

- Native `<select>` for simple cases
- Custom dropdown for searchable/multi-select
- Dropdown appears below, flips up if near viewport bottom
- Search input for lists > 7 items
- Max height: 280px with scroll
- Selected item: checkmark icon

### 6.4 Checkbox & Radio

- Custom styled (hide native, custom pseudo-element)
- Size: 18x18px, border radius: `--radius-sm` (checkbox), `--radius-full` (radio)
- Checked: `--color-primary` fill with white check/dot
- Focus: ring around the control
- Label clickable (wraps input)
- Minimum touch target: 44x44px (padding around control)

### 6.5 Toggle / Switch

- Width: 44px, height: 24px
- Track: rounded pill, gray (off) / primary (on)
- Thumb: white circle, 20px
- Animation: slide + color change (200ms)
- Accessible: `role="switch"`, `aria-checked`

### 6.6 Modal

- Centered overlay
- Width: 480px default, 640px for complex forms
- Max height: 85vh with scrollable body
- Header: title + close button (X)
- Body: scrollable content area
- Footer: action buttons (cancel left, confirm right)
- Backdrop: `--color-surface-overlay`, no dismiss on click for forms
- Focus trap: tab cycles within modal
- Enter: does NOT submit (prevents accidental submission)
- Escape: dismisses

### 6.7 Toast

| Variant | Color             | Icon             | Auto-dismiss |
| ------- | ----------------- | ---------------- | ------------ |
| Success | `--color-success` | Checkmark circle | 4s           |
| Error   | `--color-danger`  | X circle         | 8s           |
| Warning | `--color-warning` | Alert triangle   | 6s           |
| Info    | `--color-info`    | Info circle      | 5s           |

**Spec**:

- Position: top-right (desktop), top-center (mobile)
- Width: 360px max
- Stack vertically, newest on top, max 3 visible
- Slide in from right (desktop) / top (mobile), 150ms
- Hover pauses timer
- Close button (X) on each toast
- Optional action link ("Undo")

### 6.8 Confirm Dialog

See Section 5.4 for modal spec. Additional:

**Variants**: Primary (accent confirm button), Danger (red confirm button), Warning (orange confirm button)

**Focus**: starts on Cancel button (not confirm — prevents accidental Enter)

**Button labels**: Always specific ("Delete User", "Publish Article"), never generic ("OK", "Yes")

### 6.9 Data Table

**Header Row**:

- Sticky on scroll
- Background: `--color-th-bg`
- Text: `--text-xs`, uppercase, `--font-semibold`, `--color-text-secondary`
- Sortable: click to toggle, direction arrow icon
- Checkbox for bulk select (future)

**Body Rows**:

- Height: 48px minimum
- Alternating stripe: `--color-row-stripe`
- Hover: `--color-row-hover`
- Selected: `--color-primary-light` background
- Text: `--text-sm`

**Responsive**:

- Desktop: full table with horizontal scroll if needed
- Mobile: horizontal scroll with sticky first column, or card layout for < 640px

### 6.10 Pagination

```
Showing 1-10 of 47 results     [10 ▾]  [< Prev]  1 2 3 ... 5  [Next >]
```

- Result count: left-aligned, `--text-sm`, `--color-text-secondary`
- Page size selector: dropdown (10, 25, 50)
- Page numbers: center (hidden on mobile, show only Prev/Next)
- Prev/Next: buttons, disabled at bounds

### 6.11 Search Bar

- Left icon (magnifying glass)
- Placeholder: "Search [entity]..."
- Clear button (X) appears when text entered
- Debounce: 400ms
- Width: 100% mobile, 300px desktop

### 6.12 Filter Panel

- Toggle button with badge showing active filter count
- Slides open below toolbar (200ms)
- Grid: 2 columns desktop, 1 column mobile
- One input per filterable field
- "Clear all filters" text button
- Closing panel does NOT clear filters

### 6.13 Tabs

- Horizontal tab bar with bottom border
- Active tab: `--color-primary` bottom border (2px), `--font-semibold`
- Inactive: `--color-text-secondary`, hover shows underline
- Overflow: horizontal scroll with fade indicators (mobile)
- `role="tablist"` / `role="tab"` / `role="tabpanel"`

### 6.14 Card

- Background: `--color-surface`
- Border: `1px solid var(--color-border)`
- Radius: `--radius-lg`
- Padding: `--space-6`
- Shadow: `--shadow-sm` (rest), `--shadow-md` (hover, if interactive)
- Dark theme: no border change, lighter surface = elevation

### 6.15 Badge / Status Pill

- Shape: pill (`--radius-full`)
- Padding: `2px 8px`
- Font: `--text-xs`, `--font-medium`
- Always: colored dot (8px) + text label (never color alone)

| Status   | Dot    | Background              | Text                 |
| -------- | ------ | ----------------------- | -------------------- |
| Active   | green  | `--color-success-light` | `--color-success`    |
| Pending  | orange | `--color-warning-light` | `--color-warning`    |
| Inactive | gray   | surface raised          | `--color-text-muted` |
| Error    | red    | `--color-danger-light`  | `--color-danger`     |

### 6.16 Avatar

- Shape: circle (`--radius-full`)
- Sizes: sm (24px), md (32px), lg (40px), xl (56px)
- Image: `object-fit: cover`
- Fallback: initials on colored background (color derived from name hash)
- Group: overlap (-8px margin), "+3" badge for overflow
- Border: 2px solid `--color-surface` (to separate in groups)

### 6.17 Dropdown Menu

- Trigger: click (not hover)
- Position: below trigger, auto-flip
- Width: min 180px, max 320px
- Background: `--color-surface`
- Shadow: `--shadow-md`
- Border: `1px solid var(--color-border)` (light), none (dark)
- Items: 36px height, `--space-3` padding
- Hover: `--color-row-hover`
- Active: `--color-primary-light` + `--color-primary-text`
- Destructive items: red text, at bottom, separated by divider
- Search input at top for > 7 items
- Keyboard: arrows navigate, Enter selects, Escape closes

### 6.18 Tooltip

- Trigger: hover (desktop), long-press (mobile)
- Delay: 500ms show, 200ms hide
- Position: above by default, auto-flip
- Background: `--color-text` (inverted)
- Text: `--color-text-inverse`, `--text-xs`
- Radius: `--radius-sm`
- Padding: `4px 8px`
- Max width: 240px
- Arrow: 6px triangle pointing to trigger

### 6.19 Loading States

**Skeleton Screen** (preferred over spinners):

- Shapes match content layout (text lines, rectangles for images, circles for avatars)
- Background: `--color-bg` with shimmer animation (light sweep left-to-right, 1.5s, infinite)
- Border radius matches target element

**Spinner**:

- Only for inline loading (button, small area)
- 20px circle, 2px border, `--color-primary` partial arc
- Animation: rotate 360deg, 0.8s linear infinite

**Button Loading**:

- Spinner (16px) replaces or precedes text
- Text changes to action gerund: "Creating...", "Saving...", "Deleting..."
- Button disabled during loading

### 6.20 Empty States

```
+------------------------------------------+
|                                          |
|          [Illustration / Icon]           |
|                                          |
|          No users yet                    |
|                                          |
|     Create your first user to get        |
|     started managing your team.          |
|                                          |
|          [+ Create User]                 |
|                                          |
+------------------------------------------+
```

- Centered in content area
- Icon/illustration: 64px, `--color-text-muted` at 0.5 opacity
- Title: `--text-md`, `--font-semibold`
- Description: `--text-sm`, `--color-text-secondary`, max 300px
- CTA button: primary variant (if user has create permission)

**Filtered empty**: "No results match your filters" + "Clear filters" button instead of CTA.

### 6.21 Breadcrumb

```
Home  >  Users  >  John Doe
 link    link     current (plain text)
```

- Separator: `>` or `/` (chevron icon preferred)
- Current page: not a link, `--font-medium`
- Links: `--color-text-secondary`, hover underline
- Truncate on mobile: show `...` in middle, keep first + last
- Position: below header, above page title

---

## 7. Interaction Patterns

### 7.1 CRUD Flow

**Create**:

1. User clicks "+ Create [Entity]"
2. Modal opens with empty form
3. User fills fields, inline validation on blur
4. Submit → button loading state → toast success → modal closes → table refreshes

**Edit**:

1. User clicks edit icon on row
2. Modal opens with pre-filled form
3. User modifies fields
4. Submit → button loading state → toast success → modal closes → table refreshes

**Delete**:

1. User clicks delete icon on row
2. Confirm dialog opens (danger variant): "Delete '[name]'? This cannot be undone."
3. Confirm → toast success with undo option (5s) → table refreshes
4. Undo → restore record → toast "Restored"

### 7.2 Search & Filter

- Search is global across visible text columns
- Filters are per-column, exact match (or range for dates/numbers)
- Both debounced: search 400ms, filters immediate on blur
- Both reset pagination to page 1
- URL params sync: `?search=john&filter_role=admin&page=2&sort=name&dir=asc`
- Back button restores previous state

### 7.3 Keyboard Navigation

| Key                | Action                                          |
| ------------------ | ----------------------------------------------- |
| `Tab`              | Move focus forward through interactive elements |
| `Shift+Tab`        | Move focus backward                             |
| `Enter`            | Activate focused button/link                    |
| `Space`            | Toggle checkbox, activate button                |
| `Escape`           | Close modal/dropdown/drawer                     |
| `Arrow Up/Down`    | Navigate dropdown/select options                |
| `Arrow Left/Right` | Navigate tabs                                   |
| `/`                | Focus search input (when not in a form)         |

### 7.4 Toast Usage Rules

| Action                | Toast?      | Message                                 |
| --------------------- | ----------- | --------------------------------------- |
| Create success        | Yes         | "[Entity] created"                      |
| Update success        | Yes         | "Changes saved"                         |
| Delete success        | Yes         | "[Entity] deleted" + Undo action        |
| Load page             | No          | —                                       |
| Form validation error | No          | Show inline errors                      |
| API error             | Yes (error) | "Failed to [action]. Please try again." |
| Permission denied     | No          | Show inline forbidden state             |
| Copy to clipboard     | Yes (info)  | "Copied to clipboard" (2s)              |

---

## 8. Accessibility Requirements

### 8.1 Semantic HTML

- `<nav>` for sidebar and breadcrumbs
- `<main>` for content area
- `<header>` for page header
- `<aside>` for sidebar
- `<button>` for actions (never `<div onClick>`)
- `<a>` for navigation links
- `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>` for data tables
- `<form>`, `<label>`, `<fieldset>`, `<legend>` for forms

### 8.2 ARIA

- `aria-label` on icon-only buttons
- `aria-expanded` on collapsible sections, dropdowns
- `aria-current="page"` on active nav link
- `aria-sort` on sortable table columns
- `aria-live="polite"` on dynamic content regions
- `role="alert"` on toast notifications
- `role="dialog"` on modals with `aria-modal="true"`
- `role="search"` on search forms
- `role="status"` on loading indicators

### 8.3 Color Contrast

- Normal text: 4.5:1 minimum
- Large text (18px+): 3:1 minimum
- UI components (borders, icons): 3:1 minimum
- All verified in both light and dark themes

### 8.4 Motion

- Respect `prefers-reduced-motion`: disable all animations, use instant state changes
- No auto-playing animations
- No flashing content (3 flashes/sec threshold)

### 8.5 Touch Targets

- Minimum 44x44px for all interactive elements on mobile
- Adequate spacing between targets (minimum 8px gap)

---

## 9. Dark Theme Design Rules

Beyond token swapping, dark theme requires:

1. **No pure black** — use `#0f1117` or similar warm dark
2. **No pure white text** — use `#e2e8f0` for primary text
3. **Elevation via lightness** — higher surfaces are lighter (not shadowed)
4. **Desaturated accents** — shift primary from `#2563eb` to `#3b82f6`
5. **Softer shadows** — reduce opacity, increase blur
6. **Reduce image brightness** — optional `filter: brightness(0.9)` on photos
7. **Border visibility** — slightly more visible borders in dark mode
8. **Status colors** — use lighter variants (green → `#22c55e`, red → `#ef4444`)

---

## 10. Animation Specifications

All animations use `transform` and `opacity` only (GPU-composited).

| Element          | Animation                                                 | Duration | Easing           |
| ---------------- | --------------------------------------------------------- | -------- | ---------------- |
| Modal open       | Scale 0.95→1.0 + fade in                                  | 200ms    | ease-out         |
| Modal close      | Scale 1.0→0.95 + fade out                                 | 150ms    | ease-in          |
| Backdrop         | Opacity 0→1                                               | 150ms    | ease             |
| Sidebar (mobile) | TranslateX -100%→0                                        | 300ms    | ease-out         |
| Toast in         | TranslateX 100%→0 (desktop) / TranslateY -100%→0 (mobile) | 150ms    | ease-out         |
| Toast out        | Opacity 1→0 + TranslateX 0→50%                            | 150ms    | ease-in          |
| Dropdown         | TranslateY -8px→0 + fade in                               | 150ms    | ease-out         |
| Filter panel     | Height 0→auto (max-height trick)                          | 200ms    | ease             |
| Skeleton shimmer | Background position sweep                                 | 1500ms   | linear, infinite |
| Button press     | Scale 1→0.98                                              | 100ms    | ease             |
| Spinner          | Rotate 360deg                                             | 800ms    | linear, infinite |

---

## 11. Iconography

**Library**: Lucide Icons (web), Lucide Flutter package (mobile)

**Usage Rules**:

- Size: 16px (inline), 20px (buttons), 24px (nav), 32px (empty states)
- Stroke width: 1.5px (default), 2px (active states)
- Color: inherits from text color (`currentColor`)
- Always pair with text for meaning (icon alone requires `aria-label`)
- Consistent metaphors across all screens:
  - Plus: create/add
  - Pencil: edit
  - Trash: delete
  - Search: search/find
  - Filter/Sliders: filter
  - ChevronDown: expand/dropdown
  - X: close/dismiss
  - Check: success/selected
  - AlertTriangle: warning
  - AlertCircle: error
  - Info: information
  - Sun/Moon: theme toggle
  - Menu: hamburger
  - LogOut: sign out
  - User: profile/account
  - Settings/Gear: settings
  - Home: dashboard
  - ArrowLeft: back navigation

---

## 12. Auto-Entity System Design

### 12.1 `/_meta` Response Schema

The backend exposes `GET /api/v1/_meta` which the frontend consumes to auto-generate UI. Expected response:

```json
{
  "entities": [
    {
      "name": "users",
      "display_name": "Users",
      "slug": "users",
      "api_prefix": "/api/v1/users",
      "soft_delete": false,
      "permissions": {
        "read": true,
        "create": true,
        "update": true,
        "delete": true,
        "bulk_create": true,
        "bulk_delete": true
      },
      "fields": [
        {
          "key": "name",
          "label": "Name",
          "type": "text",
          "required": true,
          "max_length": 100,
          "filterable": true,
          "sortable": true
        },
        {
          "key": "role_id",
          "label": "Role",
          "type": "select",
          "required": true,
          "relation": {
            "entity": "roles",
            "display_field": "name",
            "api_prefix": "/api/v1/roles"
          }
        }
      ],
      "default_sort": "name",
      "default_sort_dir": "asc"
    }
  ]
}
```

### 12.2 Unknown Field Type Handling

When the backend sends a field type the frontend doesn't recognize:

1. Render as a text input (safe fallback)
2. Log a console warning: `Unknown field type "${type}" for field "${key}", rendering as text`
3. Display value as-is in table cells (toString)

**Supported types**: text, number, date, datetime, textarea, select, boolean

**Future types** (render as text until implemented): color, file, rich-text, multi-select, json

### 12.3 Override System

Overrides allow per-entity UI customization without modifying core components.

**Override registry** (`entities/overrides.ts`):

```typescript
interface EntityOverride {
  name?: string; // Override display name
  icon?: string; // Lucide icon name
  columnOverrides?: Record<string, Partial<Column>>; // Per-column config
  fieldOverrides?: Record<string, Partial<Field>>; // Per-field config
  hideColumns?: string[]; // Columns to hide
  hideFields?: string[]; // Fields to hide from form
  customActions?: ActionConfig[]; // Extra row actions
  renderCell?: (
    key: string,
    value: unknown,
    row: Record<string, unknown>,
  ) => ReactNode;
  renderForm?: (fields: Field[], values: Record<string, unknown>) => ReactNode;
  pageComponent?: React.ComponentType; // Replace entire page
}

// Register overrides
const entityOverrides: Record<string, EntityOverride> = {
  'audit-logs': {
    name: 'Activity Log',
    columnOverrides: {
      performed_at: {
        render: (val) => formatRelativeTime(val as string),
      },
    },
  },
};
```

**Override resolution order**:

1. Entity-specific override (if exists)
2. Field type default (from `/_meta`)
3. Generic fallback (text input, toString display)

**What can be overridden**:

- Display name and icon
- Individual column rendering, visibility, sort/filter behavior
- Individual field rendering, validation, visibility
- Custom row actions beyond Edit/Delete
- Entire cell or form rendering
- Entire page component (nuclear option)

### 12.4 Relational Data (FK) Display

When a field has a `relation` property in the `/_meta` response:

**In tables**:

- Display the related entity's `display_field` value, not the raw FK ID
- Use the `expandFields` query param to fetch related data in one request
- Link the displayed value to the related entity's detail view (if exists)

**In forms**:

- Render as a searchable select/dropdown
- Load options from the related entity's API endpoint
- Show `display_field` as option label, store FK ID as value
- Support type-ahead search for large option sets (> 50 items)

**In detail view**:

- Show related entity name as a link
- Show related entity list section if reverse FK exists (e.g., User → Tasks)

### 12.5 Bulk Operations UI

When `entity.permissions.bulk_create` or `entity.permissions.bulk_delete` is true:

**Bulk Selection**:

- Checkbox column (leftmost) in table
- Header checkbox: select all on current page
- Selected count shown in toolbar: "3 selected"
- Bulk action toolbar appears when any row is selected

**Bulk Action Toolbar**:

```
+---------------------------------------------------+
| ✓ 3 selected    [Delete Selected] [Deselect All]  |
+---------------------------------------------------+
```

- Replaces the normal search toolbar when active
- Background: `--color-primary-light`
- "Delete Selected" button: danger ghost variant
- Clicking triggers confirm dialog: "Delete 3 users? This cannot be undone."

**Bulk Create**: Handled via CSV import or API — not a form UI concern.

### 12.6 Soft Delete Display

When `entity.soft_delete` is true in `/_meta`:

**In tables**:

- Soft-deleted rows: grayed out text (opacity 0.5), strikethrough on name column
- Status badge: "Deleted" in red (if no existing status column)
- Filter option: "Show deleted" toggle (off by default)
- Row actions change: "Restore" replaces "Edit", "Delete Permanently" replaces "Delete"

**Restore flow**:

1. Click "Restore" icon (undo arrow)
2. Toast: "[Entity] restored" (success)
3. Row returns to normal styling

**Permanent delete flow**:

1. Click "Delete Permanently"
2. Danger confirm dialog: "Permanently delete '[name]'? This action cannot be undone."
3. Confirm → toast success → row removed from table

### 12.7 Permission-Aware UI

The UI adapts based on `entity.permissions` from `/_meta`:

| Permission    | When `false`                                |
| ------------- | ------------------------------------------- |
| `read`        | Entity hidden from sidebar + dashboard      |
| `create`      | "Create" button hidden                      |
| `update`      | Edit icon hidden, form fields read-only     |
| `delete`      | Delete icon hidden                          |
| `bulk_delete` | Checkbox column hidden, bulk toolbar hidden |

**Partial permissions** (can read but not write):

- Table displays normally
- Action column shows only permitted actions
- If no actions available, hide the Actions column entirely
- Page header shows no "Create" button

**Forbidden state** (navigate to entity without `read` permission):

- Show 403 page: "You don't have permission to view [Entity]"
- Back to Dashboard link

---

## 13. URL State Management

All list view state syncs to URL query parameters for shareable/bookmarkable views.

**URL pattern**: `/{entity}?search=john&filter_role=admin&page=2&page_size=25&sort=name&dir=asc`

| Param          | Default        | Description             |
| -------------- | -------------- | ----------------------- |
| `search`       | (empty)        | Search query            |
| `filter_{key}` | (empty)        | Per-column filter value |
| `page`         | `1`            | Current page            |
| `page_size`    | `10`           | Page size               |
| `sort`         | entity default | Sort column             |
| `dir`          | `asc`          | Sort direction          |

**Behavior**:

- Changing search/filters/sort resets `page` to 1
- Browser back button restores previous state
- Direct URL access applies params to table
- Empty/default values omitted from URL (keep URLs clean)

**Entity detail URL**: `/{entity}/{id}` (e.g., `/users/42`)

---

## 14. Implementation Priority

### Phase 1 — Fix Existing React SPA Issues

The current implementation has gaps vs. this design spec. Fix before building new features:

- [ ] **ConfirmDialog**: Move focus to Cancel button (not Confirm), disable backdrop dismiss, add Warning variant, add Escape key handler, add enter/exit animations
- [ ] **EntityForm**: Add required field `*` indicators, implement blur validation (not just submit), disable submit when form is clean, disable backdrop dismiss, add Escape key handler, add modal animations
- [ ] **Toast**: Vary auto-dismiss times (Success 4s, Info 5s, Warning 6s, Error 8s), enforce max 3 visible, add hover-pause, add undo action support, change animation to slide (not fade)
- [ ] **EntityTable**: Add page size selector (10/25/50), add forbidden state handling, use icon buttons for actions
- [ ] **Dashboard**: Add entity type icons, add loading skeleton state, add empty state, add error state
- [ ] **useEntity**: Add URL state synchronization (search, filters, sort, page in query params)
- [ ] **ErrorBoundary**: Show generic message in production (hide error.message)
- [ ] **Layout**: Add user email to sidebar footer
- [ ] **EntityPage**: Use entity-specific labels ("Create User", not "Create"), entity-specific toast messages
- [ ] **Login**: Add loading spinner to button (not just text change)
- [x] **CSS**: Add `--color-info` family tokens (info, info-hover, info-light, info-text), add z-index tokens (`--z-dropdown` through `--z-tooltip`), add `--form-max-w`, fix semantic `-text` tokens to use readable colors for badges/alerts, fix dark theme contrast issues, add skeleton/alert/validation/disabled/status-badge/progress/offline/skip-to-content styles, add `prefers-reduced-motion` and `prefers-contrast` support, add tablet breakpoint auto-collapse

### Phase 2 — New Components

Add to React SPA and carry to other stacks:

- [ ] Breadcrumbs
- [ ] Badge / Status pill
- [ ] Avatar (with fallback initials)
- [ ] Dropdown menu
- [ ] Tooltip
- [ ] Tabs
- [ ] Drawer / side panel
- [ ] Entity detail page (dedicated route `/{entity}/{id}`)
- [ ] Settings / profile page
- [ ] Empty state illustrations
- [ ] Skeleton loading screens (replace all spinners)
- [ ] Bulk operations (checkbox selection, bulk action toolbar)
- [ ] Soft delete display (grayed rows, restore action)
- [ ] FK/relation display (linked names in table, searchable select in form)

### Phase 3 — Cross-Platform

#### React SSR/SSG Mode (via React Router v7)

- [ ] Same CSS tokens (`index.css` shared)
- [ ] React Router v7 framework mode with `ssr: true` in `react-router.config.ts`
- [ ] `loader` functions for server-side data fetching
- [ ] `prerender` option for static pages (marketing, about, pricing)
- [ ] Same components — SSR is a config toggle, not a rewrite

#### Flutter Mobile

- [ ] `AppTheme` class: complete `ThemeData` for light/dark, matching all token values
- [ ] `AppSpacing` extension: spacing scale accessible via `Theme.of(context).extension<AppSpacing>()`
- [ ] Material Design 3 components mapped to design system (Button → ElevatedButton/FilledButton, etc.)
- [ ] Widget library: `AppTable`, `AppForm`, `AppToast`, `AppConfirmDialog`
- [ ] Auto-entity screens: `EntityListScreen`, `EntityDetailScreen`, `EntityFormScreen`
- [ ] Navigation: GoRouter with `/{entity}` and `/{entity}/{id}` routes
- [ ] State management: Riverpod providers for entity data, auth state, theme
- [ ] Offline-first: Hive/Isar local cache, sync on reconnect
- [ ] Platform patterns: bottom sheets (not centered modals) for quick actions, pull-to-refresh, swipe-to-delete
- [ ] Secure storage: `flutter_secure_storage` for tokens
- [ ] Biometric auth: fingerprint/face unlock on app open (optional, per-user setting)
- [ ] Push notifications: FCM integration, notification tap → navigate to entity

### Phase 4 — Polish

- [ ] Micro-interactions (button press scale, hover states refinement)
- [ ] Keyboard shortcut system (`/` for search, `Escape` globally, `n` for new)
- [ ] RTL support (CSS logical properties, icon mirroring)
- [ ] High contrast mode (`prefers-contrast`)
- [ ] Form focus management (focus first error field on validation failure)
- [ ] Skip-to-content link (visually hidden, visible on focus)
- [ ] Screen reader testing (VoiceOver, NVDA)
- [ ] Print stylesheet
- [ ] i18n framework (string keys, language switcher, RTL layout)
- [ ] Storybook / component gallery with all states documented

---

## Appendix A: Token Quick Reference for Developers

When implementing any screen or component, reference this checklist:

```
Background  → var(--color-bg), var(--color-surface), var(--color-surface-raised)
Text        → var(--color-text), var(--color-text-secondary), var(--color-text-muted)
Border      → var(--color-border), 1px solid
Radius      → var(--radius-sm) to var(--radius-xl), var(--radius-full)
Shadow      → var(--shadow-xs) to var(--shadow-xl)
Spacing     → var(--space-0) to var(--space-12)
Font size   → var(--text-xs) to var(--text-2xl)
Font weight → var(--font-normal) to var(--font-bold)
Font family → var(--font-sans), var(--font-mono)
Transition  → var(--transition-fast/base/slow)
Z-index     → var(--z-dropdown) to var(--z-tooltip)
Focus       → box-shadow: 0 0 0 var(--ring-width) var(--ring-color)
Layout      → var(--sidebar-w), var(--content-max-w), var(--form-max-w)
Semantic    → var(--color-{success,warning,danger,info}{,-hover,-light,-text})
```

Never use raw px, hex, or rgb values in component code. If a value doesn't have a token, add one to the token system first.

---

## Appendix B: Token Completion Status

All tokens specified in this design system are now implemented in `index.css`. The complete token set includes:

- **Z-Index Scale**: `--z-dropdown` through `--z-tooltip` (6 tokens)
- **Info Semantic Color**: `--color-info`, `--color-info-hover`, `--color-info-light`, `--color-info-text` (light + dark)
- **Layout**: `--form-max-w` for form containers
- **Semantic `-text` tokens**: All use readable dark/light variants (not white) for use on tinted backgrounds (badges, alerts)

Additionally, the CSS now includes:
- Skeleton loading with shimmer animation
- Alert variants (danger, success, warning, info)
- Form validation states (field-error, field-hint, field-required)
- Disabled state styles
- Status badge with dot indicator
- Progress bar and step indicators
- Offline connection banner
- Skip-to-content accessibility link
- `prefers-reduced-motion` support
- `prefers-contrast: more` support
- Tablet breakpoint (768-1023px) auto-collapse sidebar
