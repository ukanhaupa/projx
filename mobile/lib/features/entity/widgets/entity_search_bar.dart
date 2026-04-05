import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/spacing.dart';

class EntitySearchBar extends StatefulWidget {
  final ValueChanged<String> onChanged;

  const EntitySearchBar({super.key, required this.onChanged});

  @override
  State<EntitySearchBar> createState() => _EntitySearchBarState();
}

class _EntitySearchBarState extends State<EntitySearchBar> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.sm,
      ),
      child: TextField(
        controller: _controller,
        decoration: InputDecoration(
          hintText: 'Search...',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: _controller.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear, size: 20),
                  onPressed: () {
                    _controller.clear();
                    widget.onChanged('');
                  },
                )
              : null,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: Spacing.md,
            vertical: Spacing.sm,
          ),
        ),
        onChanged: widget.onChanged,
      ),
    );
  }
}
