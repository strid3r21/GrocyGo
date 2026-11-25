import { InventoryService, NEVER_EXPIRES, todayIso, addDaysIso } from './inventoryService';

/**
 * Ultra-lightweight Read-Only MCP (Model Context Protocol) Streamable HTTP handler.
 * Designed specifically for minimal token usage: compact schemas, concise plain-text
 * line formats, no null/internal fields, and server-side filtering/pagination.
 */

const MCP_TOOLS = [
  {
    name: 'inventory_summary',
    description:
      'Compact overview of pantry stock: totals, counts per location, expiring/overdue items, and open shopping list count.',
    inputSchema: {
      type: 'object',
      properties: {
        due_soon_days: {
          type: 'integer',
          description: 'Days ahead for expiring-soon check (default 5).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_inventory',
    description:
      'Search or filter stocked food items. Returns compact one-line rows: #id Name | qty unit | Location | due | photo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive product name substring.' },
        location: { type: 'string', description: 'Filter by storage location name.' },
        status: {
          type: 'string',
          enum: ['all', 'due_soon', 'overdue', 'low'],
          description: 'Filter by expiry or low-stock status (default all).',
        },
        limit: {
          type: 'integer',
          description: 'Max rows to return (default 25, max 100).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_item',
    description:
      'Get compact details and per-location batches for one product by numeric id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID.' },
        name: { type: 'string', description: 'Product name (exact or partial match).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_locations',
    description: 'List storage locations with stocked product counts and freezer flag.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_shopping_list',
    description: 'Get compact shopping list items.',
    inputSchema: {
      type: 'object',
      properties: {
        include_done: {
          type: 'boolean',
          description: 'Include already checked items (default false).',
        },
      },
      additionalProperties: false,
    },
  },
];

function fmtQty(amount: number, unit?: string, plural?: string): string {
  const rounded = Math.round(amount * 100) / 100;
  const num = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  if (!unit) return num;
  return `${num} ${rounded === 1 ? unit : plural || unit}`;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

export function handleMcpJsonRpc(
  body: any,
  service: InventoryService
): { status: number; response: any | null } {
  if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
    return {
      status: 400,
      response: {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      },
    };
  }

  const { id, method, params } = body;

  // Notifications have no id -> return 202 Accepted with empty body
  if (id === undefined || id === null) {
    return { status: 202, response: null };
  }

  if (method === 'initialize') {
    const requestedVersion =
      typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
    return {
      status: 200,
      response: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requestedVersion,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'grocygo-mcp',
            version: '1.1.0',
          },
          instructions:
            'Read-only food inventory and shopping list MCP server. Start with inventory_summary or search_inventory.',
        },
      },
    };
  }

  if (method === 'ping') {
    return { status: 200, response: { jsonrpc: '2.0', id, result: {} } };
  }

  if (method === 'tools/list') {
    return {
      status: 200,
      response: {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    try {
      const result = executeTool(toolName, args, service);
      return { status: 200, response: { jsonrpc: '2.0', id, result } };
    } catch (err: any) {
      return {
        status: 200,
        response: {
          jsonrpc: '2.0',
          id,
          result: textResult(`Error: ${err?.message || 'Tool execution failed'}`, true),
        },
      };
    }
  }

  return {
    status: 200,
    response: {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    },
  };
}

function executeTool(name: string, args: Record<string, any>, service: InventoryService) {
  const db = service.db;
  const quMap = new Map<number, any>(
    (db.prepare('SELECT id, name, name_plural FROM quantity_units').all() as any[]).map((q) => [
      q.id,
      q,
    ])
  );
  const locMap = new Map<number, any>(
    (db.prepare('SELECT id, name, is_freezer FROM locations').all() as any[]).map((l) => [l.id, l])
  );

  if (name === 'inventory_summary') {
    const dueDays =
      typeof args.due_soon_days === 'number' && args.due_soon_days >= 0
        ? Math.min(90, Math.floor(args.due_soon_days))
        : 5;
    const stock = service.getStockOverview();
    const volatile = service.getVolatileStock(dueDays);
    const openShopping = (
      db.prepare('SELECT COUNT(*) AS c FROM shopping_list WHERE done = 0').get() as { c: number }
    ).c;

    const locCounts = db
      .prepare(
        `SELECT l.name, l.is_freezer, COUNT(DISTINCT s.product_id) AS items
         FROM locations l
         LEFT JOIN stock s ON s.location_id = l.id AND s.amount > 0
         GROUP BY l.id
         ORDER BY l.name COLLATE NOCASE ASC`
      )
      .all() as any[];

    const lines: string[] = [
      `Stock: ${stock.length} items | Due<=${dueDays}d: ${volatile.due_products.length} | Overdue: ${
        volatile.overdue_products.length + volatile.expired_products.length
      } | Low: ${volatile.missing_products.length} | Shopping(open): ${openShopping}`,
      `Locations: ${locCounts
        .map((l) => `${l.name}${l.is_freezer ? '*' : ''}(${l.items})`)
        .join(', ')}`,
    ];

    const urgent = [
      ...volatile.expired_products,
      ...volatile.overdue_products,
      ...volatile.due_products,
    ].slice(0, 10);

    if (urgent.length > 0) {
      lines.push('Expiring/Overdue:');
      for (const item of urgent) {
        const qu = quMap.get(item.product.qu_id_stock);
        const loc = locMap.get(item.product.location_id);
        lines.push(
          `- #${item.product_id} ${item.product.name} (${fmtQty(
            item.amount,
            qu?.name,
            qu?.name_plural
          )}) @ ${loc?.name || '?'} due:${item.best_before_date}`
        );
      }
    }

    return textResult(lines.join('\n'));
  }

  if (name === 'list_locations') {
    const rows = db
      .prepare(
        `SELECT l.id, l.name, l.is_freezer, l.description, COUNT(DISTINCT s.product_id) AS items
         FROM locations l
         LEFT JOIN stock s ON s.location_id = l.id AND s.amount > 0
         GROUP BY l.id
         ORDER BY l.name COLLATE NOCASE ASC`
      )
      .all() as any[];

    if (rows.length === 0) return textResult('No locations defined.');
    const lines = rows.map(
      (r) =>
        `#${r.id} ${r.name}${r.is_freezer ? ' [freezer]' : ''} | items:${r.items}${
          r.description ? ` | ${r.description}` : ''
        }`
    );
    return textResult(lines.join('\n'));
  }

  if (name === 'search_inventory') {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const locFilter = typeof args.location === 'string' ? args.location.trim().toLowerCase() : '';
    const status = typeof args.status === 'string' ? args.status : 'all';
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(100, Math.floor(args.limit))
        : 25;

    if (status === 'low') {
      const volatile = service.getVolatileStock(5);
      const filtered = volatile.missing_products
        .filter((m) => (!query ? true : m.name.toLowerCase().includes(query)))
        .slice(0, limit);
      if (filtered.length === 0) return textResult('No low-stock items found.');
      return textResult(
        filtered.map((m) => `#${m.id} ${m.name} | missing:${m.amount_missing}`).join('\n')
      );
    }

    const today = todayIso();
    const soonCutoff = addDaysIso(5);
    const stock = service.getStockOverview();

    const matched = stock.filter((item) => {
      if (query && !item.product.name.toLowerCase().includes(query)) return false;
      const loc = locMap.get(item.product.location_id);
      if (locFilter) {
        const entryLocs = service.getProductLocations(item.product_id);
        const matchesLoc =
          (loc?.name || '').toLowerCase().includes(locFilter) ||
          entryLocs.some((el) => (el.location_name || '').toLowerCase().includes(locFilter));
        if (!matchesLoc) return false;
      }
      const bbd = item.best_before_date || NEVER_EXPIRES;
      if (status === 'overdue' && !(bbd !== NEVER_EXPIRES && bbd < today)) return false;
      if (status === 'due_soon' && !(bbd !== NEVER_EXPIRES && bbd >= today && bbd <= soonCutoff)) {
        return false;
      }
      return true;
    });

    if (matched.length === 0) return textResult('No matching items.');

    const slice = matched.slice(0, limit);
    const lines = slice.map((item) => {
      const qu = quMap.get(item.product.qu_id_stock);
      const loc = locMap.get(item.product.location_id);
      const duePart =
        item.best_before_date && item.best_before_date !== NEVER_EXPIRES
          ? ` | due:${item.best_before_date}`
          : '';
      const openPart = item.amount_opened > 0 ? ` (${item.amount_opened} open)` : '';
      const photoPart = item.latest_photo_file_name ? ' | photo:yes' : '';
      return `#${item.product_id} ${item.product.name} | ${fmtQty(
        item.amount,
        qu?.name,
        qu?.name_plural
      )}${openPart} | ${loc?.name || '?'}${duePart}${photoPart}`;
    });

    if (matched.length > slice.length) {
      lines.push(`... (${matched.length - slice.length} more; refine query or raise limit)`);
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'get_item') {
    let productId: number | null = typeof args.id === 'number' ? args.id : null;
    if (!productId && typeof args.name === 'string' && args.name.trim()) {
      const exact = db
        .prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.name.trim()) as { id: number } | undefined;
      if (exact) {
        productId = exact.id;
      } else {
        const partial = db
          .prepare('SELECT id FROM products WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 1')
          .get(`%${args.name.trim()}%`) as { id: number } | undefined;
        if (partial) productId = partial.id;
      }
    }

    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);

    const details = service.getProductDetails(productId);
    if (!details) return textResult(`Product #${productId} not found.`, true);

    const entries = service.getProductEntries(productId);
    const qu = details.quantity_unit_stock;
    const lines: string[] = [
      `#${details.product.id} ${details.product.name} | total:${fmtQty(
        details.stock_amount,
        qu?.name,
        qu?.name_plural
      )}${details.stock_amount_opened > 0 ? ` (${details.stock_amount_opened} open)` : ''}`,
    ];

    if (details.product.description) lines.push(`Desc: ${details.product.description}`);
    if (details.product.min_stock_amount > 0) {
      lines.push(`Min stock: ${details.product.min_stock_amount}`);
    }
    if (details.product.picture_file_name) {
      lines.push(`Product photo: /api/photos/${details.product.picture_file_name}`);
    }
    if (details.product.storage_photo_file_name) {
      lines.push(`Shelf photo: /api/photos/${details.product.storage_photo_file_name}`);
    }

    if (entries.length === 0) {
      lines.push('Batches: none (out of stock)');
    } else {
      lines.push('Batches:');
      for (const e of entries) {
        const due =
          e.best_before_date && e.best_before_date !== NEVER_EXPIRES
            ? ` due:${e.best_before_date}`
            : '';
        const open = e.open ? ' [open]' : '';
        const note = e.note ? ` note:"${e.note}"` : '';
        const photo = e.photo_file_name ? ` photo:/api/photos/${e.photo_file_name}` : '';
        lines.push(
          `- batch#${e.id}: ${fmtQty(e.amount, qu?.name, qu?.name_plural)} @ ${
            e.location_name || '?'
          }${due}${open}${note}${photo}`
        );
      }
    }

    return textResult(lines.join('\n'));
  }

  if (name === 'get_shopping_list') {
    const includeDone = Boolean(args.include_done);
    const items = service
      .getShoppingListItems()
      .filter((i) => (includeDone ? true : !i.done));

    if (items.length === 0) {
      return textResult(includeDone ? 'Shopping list is empty.' : 'No open shopping list items.');
    }

    const lines = items.map((i) => {
      const label = i.product_name || i.note || 'Item';
      const extraNote = i.product_name && i.note ? ` (${i.note})` : '';
      const qty = fmtQty(Number(i.amount || 1), i.qu_name, i.qu_name_plural);
      return `${i.done ? '[x]' : '[ ]'} ${label} x ${qty}${extraNote}`;
    });
    return textResult(lines.join('\n'));
  }

  return textResult(`Unknown tool: ${name}`, true);
}
