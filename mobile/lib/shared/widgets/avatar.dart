import 'package:flutter/material.dart';

class AppAvatar extends StatelessWidget {
  final String? name;
  final String? imageUrl;
  final double size;

  const AppAvatar({super.key, this.name, this.imageUrl, this.size = 40});

  @override
  Widget build(BuildContext context) {
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return CircleAvatar(
        radius: size / 2,
        backgroundImage: NetworkImage(imageUrl!),
      );
    }

    final initials = _getInitials(name ?? '?');
    final color = _colorFromName(name ?? '');

    return CircleAvatar(
      radius: size / 2,
      backgroundColor: color,
      child: Text(
        initials,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.4,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  String _getInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[parts.length - 1][0]}'.toUpperCase();
  }

  Color _colorFromName(String name) {
    final colors = [
      const Color(0xFF2563EB),
      const Color(0xFF7C3AED),
      const Color(0xFFDB2777),
      const Color(0xFFDC2626),
      const Color(0xFFEA580C),
      const Color(0xFF16A34A),
      const Color(0xFF0D9488),
      const Color(0xFF2563EB),
    ];
    final hash = name.codeUnits.fold(0, (prev, curr) => prev + curr);
    return colors[hash % colors.length];
  }
}
