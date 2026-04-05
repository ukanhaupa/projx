class QueryParams {
  static Map<String, dynamic> build({
    int page = 1,
    int pageSize = 20,
    String? search,
    String? orderBy,
    Map<String, String>? filters,
    List<String>? expand,
  }) {
    final params = <String, dynamic>{'page': page, 'page_size': pageSize};

    if (search != null && search.isNotEmpty) {
      params['search'] = search;
    }

    if (orderBy != null && orderBy.isNotEmpty) {
      params['order_by'] = orderBy;
    }

    if (expand != null && expand.isNotEmpty) {
      params['expand'] = expand.join(',');
    }

    if (filters != null) {
      for (final entry in filters.entries) {
        if (entry.value.isNotEmpty) {
          params[entry.key] = entry.value;
        }
      }
    }

    return params;
  }
}
