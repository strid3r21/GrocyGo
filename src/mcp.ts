import { InventoryService, NEVER_EXPIRES, todayIso, addDaysIso } from './inventoryService';

/**
 * Compact MCP (Model Context Protocol) Streamable HTTP handler with runtime-toggleable
 * Read and Write permissions (configured in GrocyGo MCP settings).
 * Designed for minimal token usage: compact schemas, concise plain-text line formats,
 * no null/internal fields, and server-side filtering/pagination.
 */

const MCP_READ_TOOLS = [
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
      'Search or filter food items. Returns compact one-line rows: #id Name | qty unit | Location | [Group] | due | photo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive product name substring.' },
        location: { type: 'string', description: 'Filter by storage location name.' },
        group: { type: 'string', description: 'Filter by product group name.' },
        ungrouped_only: {
          type: 'boolean',
          description: 'Only return items that do not belong to any group yet (default false).',
        },
        include_out_of_stock: {
          type: 'boolean',
          description: 'Include catalog items with 0 stock (default false).',
        },
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
    name: 'list_groups',
    description: 'List product groups (e.g. Perishables, Dry, Frozen) with item counts.',
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
  {
    name: 'recent_activity',
    description:
      'Get compact household activity log showing who added, consumed, moved, grouped, or added items to the shopping list and when.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max recent events to return (default 15, max 50).',
        },
      },
      additionalProperties: false,
    },
  },
];

const MCP_WRITE_TOOLS = [
  {
    name: 'create_group',
    description: 'Create a new product group (e.g. Perishables, Dry, Wet, Frozen).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the new product group.' },
        description: { type: 'string', description: 'Optional short description.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_items_to_group',
    description:
      'Assign one or more products (by product_ids and/or product_names) to a product group (by group_id or group_name). Pass group_id: null or group_name: "" to ungroup.',
    inputSchema: {
      type: 'object',
      properties: {
        product_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'List of numeric product IDs to assign.',
        },
        product_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of product names to assign (exact case-insensitive match).',
        },
        group_id: {
          type: ['integer', 'null'],
          description: 'Target group ID (or null to ungroup).',
        },
        group_name: {
          type: ['string', 'null'],
          description: 'Target group name (or empty string / null to ungroup).',
        },
        create_group_if_missing: {
          type: 'boolean',
          description: 'If true and group_name does not exist yet, create the group automatically.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_item',
    description:
      'Edit an existing inventory item: rename, change group, location, min stock, description, or expiry date.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID to update.' },
        name: { type: 'string', description: 'Current product name (if id not provided).' },
        new_name: { type: 'string', description: 'New product name.' },
        description: { type: 'string', description: 'Updated description/notes.' },
        group_id: { type: ['integer', 'null'], description: 'Target group ID (or null to ungroup).' },
        group_name: { type: ['string', 'null'], description: 'Target group name (or "" to ungroup).' },
        location_id: { type: 'integer', description: 'Target storage location ID.' },
        location_name: { type: 'string', description: 'Target storage location name.' },
        min_stock_amount: { type: 'number', description: 'Minimum stock threshold.' },
        best_before_date: {
          type: ['string', 'null'],
          description: 'YYYY-MM-DD expiry date for active batches, or "" / null for no expiry.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_to_shopping_list',
    description:
      'Add an existing product or a custom item to the global household shopping list.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Item name (matches existing product if exact, else custom item).' },
        product_id: { type: 'integer', description: 'Optional exact product ID.' },
        amount: { type: 'number', description: 'Quantity to buy (default 1).' },
        note: { type: 'string', description: 'Optional extra note.' },
      },
      additionalProperties: false,
    },
  },
];

const MCP_DELETE_TOOLS = [
  {
    name: 'delete_group',
    description:
      'Delete a product group by group_id or group_name. Items in the group become ungrouped (not deleted).',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'integer', description: 'Group ID to delete.' },
        group_name: { type: 'string', description: 'Group name to delete.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_shopping_item',
    description: 'Delete an item from the household shopping list by numeric id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Shopping list row ID.' },
        name: { type: 'string', description: 'Shopping list item name (exact or partial match).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_item',
    description:
      'Permanently delete a product (and its stock entries/barcodes) from inventory by numeric id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID to delete.' },
        name: { type: 'string', description: 'Product name to delete (exact match).' },
      },
      additionalProperties: false,
    },
  },
];

const READ_TOOL_NAMES = new Set(MCP_READ_TOOLS.map((t) => t.name));
const WRITE_TOOL_NAMES = new Set(MCP_WRITE_TOOLS.map((t) => t.name));
const DELETE_TOOL_NAMES = new Set(MCP_DELETE_TOOLS.map((t) => t.name));

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
  service: InventoryService,
  actingUserId: number | null = null
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

  const perms = service.getMcpSettings();

  if (method === 'initialize') {
    const requestedVersion =
      typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
    const caps: string[] = [];
    if (perms.read_enabled) caps.push('Read');
    if (perms.write_enabled) caps.push('Write');
    if (perms.delete_enabled) caps.push('Delete');
    const instructions =
      caps.length > 0
        ? `GrocyGo food inventory and shopping list MCP server (Enabled permissions: ${caps.join(', ')}).`
        : 'GrocyGo MCP tools are currently disabled in server MCP settings.';

    return {
      status: 200,
      response: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requestedVersion,
          capabilities: {
            tools: { listChanged: true },
          },
          serverInfo: {
            name: 'grocygo-mcp',
            version: '1.7.0',
          },
          instructions,
        },
      },
    };
  }

  if (method === 'ping') {
    return { status: 200, response: { jsonrpc: '2.0', id, result: {} } };
  }

  if (method === 'tools/list') {
    const tools = [
      ...(perms.read_enabled ? MCP_READ_TOOLS : []),
      ...(perms.write_enabled ? MCP_WRITE_TOOLS : []),
      ...(perms.delete_enabled ? MCP_DELETE_TOOLS : []),
    ];
    return {
      status: 200,
      response: {
        jsonrpc: '2.0',
        id,
        result: { tools },
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name || '');
    const args = params?.arguments || {};

    if (READ_TOOL_NAMES.has(toolName) && !perms.read_enabled) {
      return {
        status: 200,
        response: {
          jsonrpc: '2.0',
          id,
          result: textResult(
            'Permission denied: MCP Read access is currently disabled in GrocyGo MCP settings.',
            true
          ),
        },
      };
    }

    if (WRITE_TOOL_NAMES.has(toolName) && !perms.write_enabled) {
      return {
        status: 200,
        response: {
          jsonrpc: '2.0',
          id,
          result: textResult(
            'Permission denied: MCP Write access is currently disabled in GrocyGo MCP settings. Enable Write permissions in GrocyGo to allow edits.',
            true
          ),
        },
      };
    }

    if (DELETE_TOOL_NAMES.has(toolName) && !perms.delete_enabled) {
      return {
        status: 200,
        response: {
          jsonrpc: '2.0',
          id,
          result: textResult(
            'Permission denied: MCP Delete access is currently disabled in GrocyGo MCP settings. Enable Delete permissions separately to allow deletions.',
            true
          ),
        },
      };
    }

    try {
      const result = executeTool(toolName, args, service, actingUserId);
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

function resolveProductId(
  db: InventoryService['db'],
  id?: unknown,
  name?: unknown
): number | null {
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id;
  if (typeof name === 'string' && name.trim()) {
    const trimmed = name.trim();
    const exact = db
      .prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(trimmed) as { id: number } | undefined;
    if (exact) return exact.id;
    const partial = db
      .prepare('SELECT id FROM products WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 1')
      .get(`%${trimmed}%`) as { id: number } | undefined;
    if (partial) return partial.id;
  }
  return null;
}

function executeTool(
  name: string,
  args: Record<string, any>,
  service: InventoryService,
  actingUserId: number | null
) {
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
  const groupMap = new Map<number, any>(
    (db.prepare('SELECT id, name FROM product_groups').all() as any[]).map((g) => [g.id, g])
  );

  // ─── READ TOOLS ─────────────────────────────────────────────

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

  if (name === 'list_groups') {
    const rows = db
      .prepare(
        `SELECT g.id, g.name, g.description, COUNT(p.id) AS items
         FROM product_groups g
         LEFT JOIN products p ON p.product_group_id = g.id
         GROUP BY g.id
         ORDER BY g.name COLLATE NOCASE ASC`
      )
      .all() as any[];

    const ungroupedCount = (
      db.prepare('SELECT COUNT(*) AS c FROM products WHERE product_group_id IS NULL').get() as {
        c: number;
      }
    ).c;

    if (rows.length === 0) return textResult(`No product groups defined. Ungrouped items: ${ungroupedCount}`);
    const lines = rows.map(
      (r) => `#${r.id} ${r.name} | items:${r.items}${r.description ? ` | ${r.description}` : ''}`
    );
    lines.push(`Ungrouped items: ${ungroupedCount}`);
    return textResult(lines.join('\n'));
  }

  if (name === 'search_inventory') {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const locFilter = typeof args.location === 'string' ? args.location.trim().toLowerCase() : '';
    const groupFilter = typeof args.group === 'string' ? args.group.trim().toLowerCase() : '';
    const ungroupedOnly = Boolean(args.ungrouped_only);
    const includeOutOfStock = Boolean(args.include_out_of_stock);
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
    const stockByProd = new Map<number, any>(stock.map((s) => [s.product_id, s]));

    const candidates: Array<{
      product_id: number;
      product: any;
      amount: number;
      amount_opened: number;
      best_before_date: string;
      latest_photo_file_name: string | null;
    }> = includeOutOfStock
      ? (db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE ASC').all() as any[]).map(
          (p) => {
            const s = stockByProd.get(p.id);
            return s
              ? s
              : {
                  product_id: p.id,
                  product: p,
                  amount: 0,
                  amount_opened: 0,
                  best_before_date: NEVER_EXPIRES,
                  latest_photo_file_name: p.storage_photo_file_name || p.picture_file_name || null,
                };
          }
        )
      : stock;

    const matched = candidates.filter((item) => {
      if (query && !item.product.name.toLowerCase().includes(query)) return false;
      if (ungroupedOnly && item.product.product_group_id) return false;
      const grp = item.product.product_group_id ? groupMap.get(item.product.product_group_id) : null;
      if (groupFilter && !(grp?.name || '').toLowerCase().includes(groupFilter)) return false;

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
      const grp = item.product.product_group_id ? groupMap.get(item.product.product_group_id) : null;
      const grpPart = grp ? ` | [${grp.name}]` : ' | [Ungrouped]';
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
      )}${openPart} | ${loc?.name || '?'}${grpPart}${duePart}${photoPart}`;
    });

    if (matched.length > slice.length) {
      lines.push(`... (${matched.length - slice.length} more; refine query or raise limit)`);
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'get_item') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);

    const details = service.getProductDetails(productId);
    if (!details) return textResult(`Product #${productId} not found.`, true);

    const entries = service.getProductEntries(productId);
    const qu = details.quantity_unit_stock;
    const grp = details.product.product_group_id
      ? groupMap.get(details.product.product_group_id)
      : null;

    const lines: string[] = [
      `#${details.product.id} ${details.product.name} | total:${fmtQty(
        details.stock_amount,
        qu?.name,
        qu?.name_plural
      )}${details.stock_amount_opened > 0 ? ` (${details.stock_amount_opened} open)` : ''}`,
    ];

    lines.push(`Group: ${grp ? `${grp.name} (#${grp.id})` : 'Ungrouped'}`);
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
      const by = i.added_by_name ? ` [by ${i.added_by_name}]` : '';
      return `${i.done ? '[x]' : '[ ]'} ${label} x ${qty}${extraNote}${by}`;
    });
    return textResult(lines.join('\n'));
  }

  if (name === 'recent_activity') {
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(50, Math.floor(args.limit))
        : 15;
    const events = service.getActivity({ limit });
    if (events.length === 0) return textResult('No recent activity.');

    const verbMap: Record<string, string> = {
      purchase: 'added',
      consume: 'used',
      spoiled: 'marked spoiled',
      open: 'opened',
      transfer: 'moved',
      shopping_add: 'added to shopping list',
      shopping_done: 'checked off shopping list',
      photo_product: 'updated product photo for',
      photo_shelf: 'updated shelf photo for',
      photo_product_remove: 'removed product photo for',
      photo_shelf_remove: 'removed shelf photo for',
      product_create: 'created item',
      product_edit: 'edited',
      bulk_group: 'grouped',
      location_create: 'created location',
      location_edit: 'updated location',
      group_create: 'created group',
      group_edit: 'updated group',
    };

    const lines = events.map((e) => {
      const verb = verbMap[e.transaction_type] || e.transaction_type;
      const qty = Math.abs(Number(e.amount || 0));
      const qtyStr = qty > 0 ? `${fmtQty(qty, e.qu_name, e.qu_name_plural)} ` : '';
      const locStr = e.location_name ? ` @ ${e.location_name}` : '';
      const noteStr = e.note ? ` (${e.note})` : '';
      return `${e.timestamp} | ${e.user_display_name} ${verb} ${qtyStr}${e.product_name}${locStr}${noteStr}`;
    });
    return textResult(lines.join('\n'));
  }

  // ─── WRITE TOOLS ────────────────────────────────────────────

  if (name === 'create_group') {
    const grpName = typeof args.name === 'string' ? args.name.trim() : '';
    if (!grpName) return textResult('Provide a non-empty group name.', true);
    const created = service.createProductGroup(
      grpName,
      typeof args.description === 'string' ? args.description : '',
      actingUserId
    );
    return textResult(`Created group #${created.id}: ${created.name}`);
  }

  if (name === 'assign_items_to_group') {
    const ids = new Set<number>();
    if (Array.isArray(args.product_ids)) {
      for (const rawId of args.product_ids) {
        const n = Number(rawId);
        if (Number.isInteger(n) && n > 0) ids.add(n);
      }
    }

    const missingNames: string[] = [];
    if (Array.isArray(args.product_names)) {
      for (const rawName of args.product_names) {
        if (typeof rawName !== 'string' || !rawName.trim()) continue;
        const resolved = resolveProductId(db, undefined, rawName);
        if (resolved) ids.add(resolved);
        else missingNames.push(rawName.trim());
      }
    }

    if (ids.size === 0) {
      return textResult(
        missingNames.length > 0
          ? `No matching products found for: ${missingNames.join(', ')}`
          : 'Provide product_ids and/or product_names to assign.',
        true
      );
    }

    let targetGroupId: number | null = null;
    let targetGroupLabel = 'Ungrouped';

    if (typeof args.group_id === 'number' && Number.isInteger(args.group_id) && args.group_id > 0) {
      const g = db
        .prepare('SELECT id, name FROM product_groups WHERE id = ?')
        .get(args.group_id) as { id: number; name: string } | undefined;
      if (!g) return textResult(`Group #${args.group_id} not found.`, true);
      targetGroupId = g.id;
      targetGroupLabel = `${g.name} (#${g.id})`;
    } else if (typeof args.group_name === 'string' && args.group_name.trim()) {
      const cleanG = args.group_name.trim();
      if (cleanG.toLowerCase() !== 'ungrouped') {
        const g = db
          .prepare('SELECT id, name FROM product_groups WHERE LOWER(name) = LOWER(?) LIMIT 1')
          .get(cleanG) as { id: number; name: string } | undefined;
        if (g) {
          targetGroupId = g.id;
          targetGroupLabel = `${g.name} (#${g.id})`;
        } else if (args.create_group_if_missing) {
          const created = service.createProductGroup(cleanG, '', actingUserId);
          targetGroupId = created.id;
          targetGroupLabel = `${created.name} (#${created.id}, created)`;
        } else {
          return textResult(
            `Group "${cleanG}" not found. Call list_groups to see existing groups, or pass create_group_if_missing: true.`,
            true
          );
        }
      }
    }

    const res = service.bulkAssignProductGroup(Array.from(ids), targetGroupId, actingUserId);
    const suffix =
      missingNames.length > 0 ? ` (not found: ${missingNames.join(', ')})` : '';
    return textResult(
      `Assigned ${res.updated} ${res.updated === 1 ? 'item' : 'items'} to ${targetGroupLabel}.${suffix}`
    );
  }

  if (name === 'update_item') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);

    const payload: Record<string, any> = {};
    if (typeof args.new_name === 'string' && args.new_name.trim()) {
      payload.name = args.new_name.trim();
    }
    if (typeof args.description === 'string') {
      payload.description = args.description;
    }
    if (args.group_id !== undefined) {
      payload.product_group_id = args.group_id === null ? null : Number(args.group_id);
    } else if (args.group_name !== undefined) {
      if (args.group_name === null || String(args.group_name).trim() === '' || String(args.group_name).trim().toLowerCase() === 'ungrouped') {
        payload.product_group_id = null;
      } else {
        const g = db
          .prepare('SELECT id FROM product_groups WHERE LOWER(name) = LOWER(?) LIMIT 1')
          .get(String(args.group_name).trim()) as { id: number } | undefined;
        if (!g) return textResult(`Group "${args.group_name}" not found.`, true);
        payload.product_group_id = g.id;
      }
    }
    if (typeof args.location_id === 'number') {
      payload.location_id = args.location_id;
    } else if (typeof args.location_name === 'string' && args.location_name.trim()) {
      const l = db
        .prepare('SELECT id FROM locations WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.location_name.trim()) as { id: number } | undefined;
      if (!l) return textResult(`Location "${args.location_name}" not found.`, true);
      payload.location_id = l.id;
    }
    if (typeof args.min_stock_amount === 'number') {
      payload.min_stock_amount = args.min_stock_amount;
    }
    if (args.best_before_date !== undefined) {
      payload.best_before_date = args.best_before_date;
    }

    const updated = service.editInventoryItem(productId, payload, actingUserId);
    const updatedGrp = updated?.product?.product_group_id
      ? groupMap.get(updated.product.product_group_id)
      : null;
    return textResult(
      `Updated #${productId} ${updated?.product?.name || ''}${
        updatedGrp ? ` | Group: ${updatedGrp.name}` : ''
      }`
    );
  }

  if (name === 'add_to_shopping_list') {
    const qty = typeof args.amount === 'number' && args.amount > 0 ? args.amount : 1;
    let productId: number | null =
      typeof args.product_id === 'number' && args.product_id > 0 ? args.product_id : null;
    let itemName = typeof args.name === 'string' ? args.name.trim() : '';

    if (productId) {
      const p = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
        | { id: number; name: string }
        | undefined;
      if (!p) return textResult(`Product #${productId} not found.`, true);
      itemName = p.name;
    } else if (itemName) {
      const exact = db
        .prepare('SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(itemName) as { id: number; name: string } | undefined;
      if (exact) {
        productId = exact.id;
        itemName = exact.name;
      }
    }

    if (!productId && !itemName) {
      return textResult('Provide name or product_id to add to the shopping list.', true);
    }

    const extraNote = typeof args.note === 'string' ? args.note.trim() : '';
    const storedNote = productId ? extraNote : itemName + (extraNote ? ` (${extraNote})` : '');

    const info = db
      .prepare(
        `INSERT INTO shopping_list (product_id, note, amount, shopping_list_id, done, added_by_user_id)
         VALUES (?, ?, ?, 1, 0, ?)`
      )
      .run(productId, storedNote, qty, actingUserId);

    service.logActivity({
      productId,
      itemLabel: itemName,
      amount: qty,
      transactionType: 'shopping_add',
      note: productId && extraNote ? extraNote : '',
      userId: actingUserId,
    });
    service.recordShoppingListNotification(actingUserId, itemName);

    return textResult(`Added to shopping list (#${Number(info.lastInsertRowid)}): ${itemName} x ${qty}`);
  }

  // ─── DELETE TOOLS ───────────────────────────────────────────

  if (name === 'delete_group') {
    let target: { id: number; name: string } | undefined;
    if (typeof args.group_id === 'number' && args.group_id > 0) {
      target = db
        .prepare('SELECT id, name FROM product_groups WHERE id = ?')
        .get(args.group_id) as { id: number; name: string } | undefined;
    } else if (typeof args.group_name === 'string' && args.group_name.trim()) {
      target = db
        .prepare('SELECT id, name FROM product_groups WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.group_name.trim()) as { id: number; name: string } | undefined;
    }
    if (!target) return textResult('Group not found. Provide a valid group_id or group_name.', true);
    db.prepare('DELETE FROM product_groups WHERE id = ?').run(target.id);
    service.logActivity({
      itemLabel: target.name,
      amount: 0,
      transactionType: 'group_delete',
      userId: actingUserId,
    });
    return textResult(`Deleted group #${target.id}: ${target.name} (items are now ungrouped).`);
  }

  if (name === 'delete_shopping_item') {
    let row: any;
    if (typeof args.id === 'number' && args.id > 0) {
      row = db
        .prepare(
          `SELECT sl.id, COALESCE(p.name, sl.note, 'Item') AS label
           FROM shopping_list sl LEFT JOIN products p ON p.id = sl.product_id WHERE sl.id = ?`
        )
        .get(args.id);
    } else if (typeof args.name === 'string' && args.name.trim()) {
      const q = args.name.trim();
      row = db
        .prepare(
          `SELECT sl.id, COALESCE(p.name, sl.note, 'Item') AS label
           FROM shopping_list sl LEFT JOIN products p ON p.id = sl.product_id
           WHERE LOWER(COALESCE(p.name, sl.note, '')) = LOWER(?)
              OR LOWER(COALESCE(p.name, sl.note, '')) LIKE LOWER(?)
           ORDER BY sl.id DESC LIMIT 1`
        )
        .get(q, `%${q}%`);
    }
    if (!row) return textResult('Shopping list item not found.', true);
    db.prepare('DELETE FROM shopping_list WHERE id = ?').run(row.id);
    return textResult(`Removed from shopping list (#${row.id}): ${row.label}`);
  }

  if (name === 'delete_item') {
    let target: { id: number; name: string; picture_file_name: string | null; storage_photo_file_name: string | null } | undefined;
    if (typeof args.id === 'number' && args.id > 0) {
      target = db
        .prepare('SELECT id, name, picture_file_name, storage_photo_file_name FROM products WHERE id = ?')
        .get(args.id) as any;
    } else if (typeof args.name === 'string' && args.name.trim()) {
      target = db
        .prepare('SELECT id, name, picture_file_name, storage_photo_file_name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.name.trim()) as any;
    }
    if (!target) return textResult('Product not found. Provide exact id or name.', true);
    db.prepare('DELETE FROM products WHERE id = ?').run(target.id);
    service.cleanupPhotoIfUnused(target.picture_file_name);
    service.cleanupPhotoIfUnused(target.storage_photo_file_name);
    service.logActivity({
      productId: null,
      itemLabel: target.name,
      amount: 0,
      transactionType: 'product_delete',
      userId: actingUserId,
    });
    return textResult(`Deleted product #${target.id}: ${target.name}`);
  }

  return textResult(`Unknown tool: ${name}`, true);
}
