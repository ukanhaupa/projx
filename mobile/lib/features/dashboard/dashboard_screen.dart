import 'package:flutter/material.dart';
import 'package:projx_mobile/core/theme/spacing.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
      ),
      body: const Padding(
        padding: Spacing.pagePadding,
        child: Center(
          child: Text('Welcome. Build your application surface here.'),
        ),
      ),
    );
  }
}
