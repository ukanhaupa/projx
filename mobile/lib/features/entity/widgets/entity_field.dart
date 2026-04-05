import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:projx_mobile/entities/base/entity_config.dart';

class EntityField extends StatelessWidget {
  final FieldConfig field;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;

  const EntityField({
    super.key,
    required this.field,
    this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return switch (field.fieldType) {
      FieldType.text => _buildTextField(context),
      FieldType.number => _buildNumberField(context),
      FieldType.textarea => _buildTextArea(context),
      FieldType.boolean => _buildBooleanField(context),
      FieldType.date => _buildDateField(context),
      FieldType.datetime => _buildDateTimeField(context),
      FieldType.select => _buildSelectField(context),
    };
  }

  Widget _buildTextField(BuildContext context) {
    return TextFormField(
      initialValue: value?.toString(),
      decoration: InputDecoration(
        labelText: field.label,
        hintText: 'Enter ${field.label.toLowerCase()}',
      ),
      maxLength: field.maxLength,
      validator: _getValidator(),
      onChanged: onChanged,
    );
  }

  Widget _buildNumberField(BuildContext context) {
    return TextFormField(
      initialValue: value?.toString(),
      decoration: InputDecoration(
        labelText: field.label,
        hintText: 'Enter ${field.label.toLowerCase()}',
      ),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
      validator: (val) {
        if (field.isRequired && (val == null || val.isEmpty)) {
          return 'This field is required';
        }
        if (val != null && val.isNotEmpty && num.tryParse(val) == null) {
          return 'Please enter a valid number';
        }
        return null;
      },
      onChanged: (val) {
        final parsed = num.tryParse(val);
        onChanged(parsed ?? val);
      },
    );
  }

  Widget _buildTextArea(BuildContext context) {
    return TextFormField(
      initialValue: value?.toString(),
      decoration: InputDecoration(
        labelText: field.label,
        hintText: 'Enter ${field.label.toLowerCase()}',
        alignLabelWithHint: true,
      ),
      maxLines: null,
      minLines: 3,
      validator: _getValidator(),
      onChanged: onChanged,
    );
  }

  Widget _buildBooleanField(BuildContext context) {
    return SwitchListTile(
      title: Text(field.label),
      value: value == true,
      onChanged: (val) => onChanged(val),
      contentPadding: EdgeInsets.zero,
    );
  }

  Widget _buildDateField(BuildContext context) {
    final dateStr = value?.toString();
    DateTime? current;
    if (dateStr != null && dateStr.isNotEmpty) {
      current = DateTime.tryParse(dateStr);
    }

    return TextFormField(
      readOnly: true,
      controller: TextEditingController(
        text: current != null ? DateFormat.yMMMd().format(current) : '',
      ),
      decoration: InputDecoration(
        labelText: field.label,
        suffixIcon: const Icon(Icons.calendar_today, size: 20),
      ),
      validator: _getValidator(),
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: current ?? DateTime.now(),
          firstDate: DateTime(1900),
          lastDate: DateTime(2100),
        );
        if (picked != null) {
          onChanged(picked.toIso8601String().split('T').first);
        }
      },
    );
  }

  Widget _buildDateTimeField(BuildContext context) {
    final dateStr = value?.toString();
    DateTime? current;
    if (dateStr != null && dateStr.isNotEmpty) {
      current = DateTime.tryParse(dateStr);
    }

    return TextFormField(
      readOnly: true,
      controller: TextEditingController(
        text:
            current != null ? DateFormat.yMMMd().add_jm().format(current) : '',
      ),
      decoration: InputDecoration(
        labelText: field.label,
        suffixIcon: const Icon(Icons.access_time, size: 20),
      ),
      validator: _getValidator(),
      onTap: () async {
        final pickedDate = await showDatePicker(
          context: context,
          initialDate: current ?? DateTime.now(),
          firstDate: DateTime(1900),
          lastDate: DateTime(2100),
        );
        if (pickedDate == null || !context.mounted) return;

        final pickedTime = await showTimePicker(
          context: context,
          initialTime: current != null
              ? TimeOfDay.fromDateTime(current)
              : TimeOfDay.now(),
        );
        if (pickedTime == null) return;

        final combined = DateTime(
          pickedDate.year,
          pickedDate.month,
          pickedDate.day,
          pickedTime.hour,
          pickedTime.minute,
        );
        onChanged(combined.toIso8601String());
      },
    );
  }

  Widget _buildSelectField(BuildContext context) {
    if (field.options != null && field.options!.length > 10) {
      return _buildSelectBottomSheet(context);
    }

    return DropdownButtonFormField<String>(
      initialValue: value?.toString(),
      decoration: InputDecoration(labelText: field.label),
      items: (field.options ?? [])
          .map((opt) => DropdownMenuItem(value: opt, child: Text(opt)))
          .toList(),
      validator: _getValidator(),
      onChanged: (val) => onChanged(val),
    );
  }

  Widget _buildSelectBottomSheet(BuildContext context) {
    return TextFormField(
      readOnly: true,
      controller: TextEditingController(text: value?.toString() ?? ''),
      decoration: InputDecoration(
        labelText: field.label,
        suffixIcon: const Icon(Icons.arrow_drop_down),
      ),
      validator: _getValidator(),
      onTap: () async {
        final result = await showModalBottomSheet<String>(
          context: context,
          isScrollControlled: true,
          builder: (_) => _SelectBottomSheet(
            title: field.label,
            options: field.options ?? [],
            selected: value?.toString(),
          ),
        );
        if (result != null) onChanged(result);
      },
    );
  }

  FormFieldValidator<String>? _getValidator() {
    if (!field.isRequired) return null;
    return (val) {
      if (val == null || val.isEmpty) return 'This field is required';
      return null;
    };
  }
}

class _SelectBottomSheet extends StatefulWidget {
  final String title;
  final List<String> options;
  final String? selected;

  const _SelectBottomSheet({
    required this.title,
    required this.options,
    this.selected,
  });

  @override
  State<_SelectBottomSheet> createState() => _SelectBottomSheetState();
}

class _SelectBottomSheetState extends State<_SelectBottomSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.options
        .where((opt) => opt.toLowerCase().contains(_query.toLowerCase()))
        .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, scrollController) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search ${widget.title}...',
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (val) => setState(() => _query = val),
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: scrollController,
              itemCount: filtered.length,
              itemBuilder: (_, index) {
                final opt = filtered[index];
                return ListTile(
                  title: Text(opt),
                  trailing: opt == widget.selected
                      ? Icon(
                          Icons.check,
                          color: Theme.of(context).colorScheme.primary,
                        )
                      : null,
                  onTap: () => Navigator.of(context).pop(opt),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
