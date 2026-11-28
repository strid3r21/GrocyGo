import { InventoryService, NEVER_EXPIRES, todayIso, addDaysIso } from './inventoryService';
import { MAX_PHOTO_BYTES, savePhotoBase64, savePhotoBuffer } from './photos';

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
  {
    name: 'list_recipes',
    description:
      'List recipes with in-stock coverage and expiring/urgent ingredient counts. Sort by urgent (default, uses most expiring/overdue/opened items first), coverage, name, or recent.',
    inputSchema: {
      type: 'object',
      properties: {
        sort: {
          type: 'string',
          enum: ['urgent', 'coverage', 'name', 'recent'],
          description: 'Sort order (default urgent).',
        },
        query: { type: 'string', description: 'Optional search substring across recipe name, tags, or ingredients.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recipe',
    description: 'Get full recipe details, instructions, and ingredient stock/expiry status by recipe_id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'integer', description: 'Numeric recipe ID.' },
        name: { type: 'string', description: 'Recipe name (exact or partial match).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_price_history',
    description:
      'Get price history, latest/min/avg/max price, price change %, and store-by-store records for a product by id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID.' },
        name: { type: 'string', description: 'Product name (exact or partial match).' },
        limit: { type: 'integer', description: 'Max history entries to return (default 20, max 50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_prices',
    description:
      'Compare latest recorded prices across products and stores (e.g. filter by store like Kroger/Meijer or product query, sort by recent, cheapest, or expensive).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional product name substring.' },
        store: { type: 'string', description: 'Optional store name substring (e.g. Kroger, Meijer).' },
        sort: {
          type: 'string',
          enum: ['recent', 'cheapest', 'expensive'],
          description: 'Sort order (default recent).',
        },
        limit: { type: 'integer', description: 'Max rows to return (default 25, max 100).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_receipts',
    description:
      'List scanned grocery receipts with store, date, total spend, and item counts. Supports filtering by store or recent days.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Optional store name substring filter.' },
        days: { type: 'integer', description: 'Optional lookback window in days (e.g. 30, 90).' },
        limit: { type: 'integer', description: 'Max receipts to return (default 15, max 50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_receipt',
    description: 'Get full receipt details including store, date, subtotal/tax/total, and all line items with prices.',
    inputSchema: {
      type: 'object',
      required: ['receipt_id'],
      properties: {
        receipt_id: { type: 'integer', description: 'Numeric receipt ID.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_stats',
    description:
      'Get household pantry analytics: inventory value, expiry horizon distribution, consumption vs waste rate, top used/spoiled items, and data health.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Analytics window in days (default 30, range 1-365).' },
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
  {
    name: 'create_recipe',
    description:
      'Create a new recipe with ingredients linked to inventory products (provide product_id or product_name; server auto-matches existing inventory items).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Recipe title.' },
        description: { type: 'string', description: 'Short summary or subtitle.' },
        instructions: { type: 'string', description: 'Step-by-step cooking instructions.' },
        servings: { type: 'number', description: 'Number of servings (default 2).' },
        prep_minutes: { type: 'integer', description: 'Prep time in minutes.' },
        cook_minutes: { type: 'integer', description: 'Cook time in minutes.' },
        tags: { type: 'string', description: 'Comma-separated tags (e.g. "Dinner, Chicken, Quick").' },
        source_url: { type: 'string', description: 'Optional source URL or cookbook reference.' },
        photo_url: {
          type: 'string',
          description: 'Optional HTTP/HTTPS image URL for the recipe photo (server downloads and stores it).',
        },
        photo_base64: {
          type: 'string',
          description: 'Optional base64-encoded image (or data:image/...;base64,... URI) for the recipe photo.',
        },
        photo_mime_type: {
          type: 'string',
          description: 'Optional MIME type when using photo_base64 (e.g. image/jpeg, image/png, image/webp; default image/jpeg).',
        },
        ingredients: {
          type: 'array',
          description: 'List of ingredients. Pass product_id or product_name to link to inventory.',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'integer', description: 'Existing inventory product ID (optional).' },
              product_name: { type: 'string', description: 'Existing inventory product name to auto-link (optional).' },
              ingredient_name: { type: 'string', description: 'Display name of ingredient.' },
              amount: { type: 'number', description: 'Quantity needed (default 1).' },
              unit: { type: 'string', description: 'Measurement unit (e.g. lb, cup, tbsp).' },
              note: { type: 'string', description: 'Prep note (e.g. diced, melted).' },
              optional: { type: 'boolean', description: 'Whether ingredient is optional (default false).' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_recipe',
    description:
      'Edit an existing recipe by recipe_id (or exact name). Only provided fields are changed; passing ingredients replaces the ingredient list.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'integer', description: 'Recipe ID to update.' },
        name: { type: 'string', description: 'Current recipe name (if recipe_id omitted) or new name.' },
        new_name: { type: 'string', description: 'New recipe title (use when renaming).' },
        description: { type: 'string' },
        instructions: { type: 'string' },
        servings: { type: 'number' },
        prep_minutes: { type: 'integer' },
        cook_minutes: { type: 'integer' },
        tags: { type: 'string' },
        source_url: { type: 'string' },
        photo_url: {
          type: ['string', 'null'],
          description: 'HTTP/HTTPS image URL to set as the recipe photo (or null / "" to remove).',
        },
        photo_base64: {
          type: 'string',
          description: 'Base64-encoded image (or data:image/...;base64,... URI) to set as the recipe photo.',
        },
        photo_mime_type: {
          type: 'string',
          description: 'Optional MIME type when using photo_base64 (default image/jpeg).',
        },
        remove_photo: {
          type: 'boolean',
          description: 'Set true to remove the existing recipe photo.',
        },
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'integer' },
              product_name: { type: 'string' },
              ingredient_name: { type: 'string' },
              amount: { type: 'number' },
              unit: { type: 'string' },
              note: { type: 'string' },
              optional: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_recipe_missing_to_shopping',
    description: 'Add all missing (out-of-stock, non-optional) ingredients of a recipe to the shopping list.',
    inputSchema: {
      type: 'object',
      required: ['recipe_id'],
      properties: {
        recipe_id: { type: 'integer', description: 'Recipe ID.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_stock',
    description:
      'Add/purchase stock for an existing product by id or name, optionally recording unit price, expiry date, location, and note.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID.' },
        name: { type: 'string', description: 'Product name (if id omitted).' },
        amount: { type: 'number', description: 'Quantity to add (default 1).' },
        price: { type: 'number', description: 'Optional unit price (e.g. 4.99).' },
        best_before_date: { type: 'string', description: 'Optional YYYY-MM-DD expiry date.' },
        location_id: { type: 'integer', description: 'Optional storage location ID.' },
        location_name: { type: 'string', description: 'Optional storage location name.' },
        note: { type: 'string', description: 'Optional batch note.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'consume_stock',
    description:
      'Consume (use) or mark spoiled stock for an existing product by id or name.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID.' },
        name: { type: 'string', description: 'Product name (if id omitted).' },
        amount: { type: 'number', description: 'Quantity to consume (default 1).' },
        spoiled: { type: 'boolean', description: 'Set true if item was thrown out/spoiled (default false).' },
        location_id: { type: 'integer', description: 'Optional storage location ID to consume from.' },
        location_name: { type: 'string', description: 'Optional storage location name to consume from.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'snooze_expiry',
    description:
      'Mark an overdue or expiring item (like spices or dry goods) as "Still Good" by extending its best-before date by months/days or setting no expiry.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Product ID.' },
        name: { type: 'string', description: 'Product name (if id omitted).' },
        stock_entry_id: { type: 'integer', description: 'Optional specific batch ID.' },
        months: { type: 'integer', description: 'Extend expiry by N months from today (e.g. 3, 6, 12).' },
        days: { type: 'integer', description: 'Extend expiry by N days from today.' },
        never_expires: { type: 'boolean', description: 'Set true to mark as no expiry.' },
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
  {
    name: 'delete_recipe',
    description: 'Permanently delete a recipe by recipe_id or exact name.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'integer', description: 'Recipe ID to delete.' },
        name: { type: 'string', description: 'Recipe name to delete (exact match).' },
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

async function resolveRecipePhotoArg(
  photosDir: string,
  args: Record<string, any>,
  allowClear: boolean
): Promise<string | null | undefined> {
  if (allowClear && (args.remove_photo === true || args.photo_url === null || args.photo_url === '')) {
    return null;
  }

  if (typeof args.photo_base64 === 'string' && args.photo_base64.trim()) {
    const mime =
      typeof args.photo_mime_type === 'string' && args.photo_mime_type.trim()
        ? args.photo_mime_type.trim()
        : 'image/jpeg';
    const saved = await savePhotoBase64(photosDir, args.photo_base64, mime);
    return saved.fileName;
  }

  if (typeof args.photo_url === 'string' && args.photo_url.trim()) {
    const rawUrl = args.photo_url.trim();
    if (!/^https?:\/\//i.test(rawUrl)) {
      throw new Error('photo_url must start with http:// or https://');
    }
    const imgRes = await fetch(rawUrl, { signal: AbortSignal.timeout(12_000) });
    if (!imgRes.ok) {
      throw new Error(`Could not download recipe image (HTTP ${imgRes.status})`);
    }
    const contentLength = Number(imgRes.headers.get('content-length') || 0);
    if (contentLength > MAX_PHOTO_BYTES) {
      throw new Error('Recipe image exceeds 12 MB limit');
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length === 0) {
      throw new Error('Downloaded recipe image was empty');
    }
    const mime = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream') {
      throw new Error(`URL did not return an image (content-type: ${mime})`);
    }
    const saved = await savePhotoBuffer(photosDir, buf, mime.startsWith('image/') ? mime : 'image/jpeg');
    return saved.fileName;
  }

  return undefined;
}

export async function handleMcpJsonRpc(
  body: any,
  service: InventoryService,
  actingUserId: number | null = null
): Promise<{ status: number; response: any | null }> {
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
            version: '2.5.0',
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
      const result = await executeTool(toolName, args, service, actingUserId);
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

async function executeTool(
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

    const valueRow = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN price IS NOT NULL AND price > 0 THEN amount * price ELSE 0 END), 0) AS total_value
         FROM stock WHERE amount > 0`
      )
      .get() as { total_value: number };
    const spend30Row = db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(total_amount, 0)), 0) AS spend_30d, COUNT(*) AS receipt_count
         FROM receipts WHERE purchase_date >= date('now', '-30 days')`
      )
      .get() as { spend_30d: number; receipt_count: number };

    const valueParts: string[] = [];
    if (valueRow.total_value > 0) valueParts.push(`Pantry value: $${valueRow.total_value.toFixed(2)}`);
    if (spend30Row.receipt_count > 0) {
      valueParts.push(
        `Receipts(30d): ${spend30Row.receipt_count} ($${spend30Row.spend_30d.toFixed(2)})`
      );
    }

    const lines: string[] = [
      `Stock: ${stock.length} items | Due<=${dueDays}d: ${volatile.due_products.length} | Overdue: ${
        volatile.overdue_products.length + volatile.expired_products.length
      } | Low: ${volatile.missing_products.length} | Shopping(open): ${openShopping}`,
      ...(valueParts.length > 0 ? [valueParts.join(' | ')] : []),
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

    const priceHist = service.getProductPriceHistory(productId);
    if (priceHist.count > 0 && priceHist.latest_price !== null) {
      const latestRec = priceHist.history[0];
      const storeStr = latestRec?.store_name ? ` @ ${latestRec.store_name}` : '';
      const dateStr = latestRec?.purchased_date ? ` (${latestRec.purchased_date})` : '';
      const rangeStr =
        priceHist.count > 1
          ? ` | avg:$${priceHist.avg_price?.toFixed(2)} range:$${priceHist.min_price?.toFixed(2)}-$${priceHist.max_price?.toFixed(2)} (${priceHist.count} records)`
          : '';
      lines.push(`Price: $${priceHist.latest_price.toFixed(2)}${storeStr}${dateStr}${rangeStr}`);
    }

    const nutParts: string[] = [];
    if (details.product.calories_kcal !== null && details.product.calories_kcal !== undefined) {
      nutParts.push(
        `${details.product.calories_kcal} kcal/${details.product.calories_basis === 'serving' ? 'srv' : '100g'}`
      );
    }
    if (details.product.protein_g !== null && details.product.protein_g !== undefined) {
      nutParts.push(`P:${details.product.protein_g}g`);
    }
    if (details.product.carbs_g !== null && details.product.carbs_g !== undefined) {
      nutParts.push(`C:${details.product.carbs_g}g`);
    }
    if (details.product.fat_g !== null && details.product.fat_g !== undefined) {
      nutParts.push(`F:${details.product.fat_g}g`);
    }
    if (details.product.sugar_g !== null && details.product.sugar_g !== undefined) {
      nutParts.push(`Sugar:${details.product.sugar_g}g`);
    }
    if (details.product.sodium_mg !== null && details.product.sodium_mg !== undefined) {
      nutParts.push(`Na:${details.product.sodium_mg}mg`);
    }
    if (details.product.serving_size) {
      nutParts.push(`serving:${details.product.serving_size}`);
    }
    if (details.product.nutriscore_grade) {
      nutParts.push(`Nutri-Score:${String(details.product.nutriscore_grade).toUpperCase()}`);
    }
    if (nutParts.length > 0) {
      lines.push(`Nutrition: ${nutParts.join(' | ')}`);
    }

    const barcodes = (
      db
        .prepare('SELECT barcode FROM product_barcodes WHERE product_id = ? ORDER BY id ASC')
        .all(productId) as Array<{ barcode: string }>
    ).map((b) => b.barcode);
    if (barcodes.length > 0) {
      lines.push(`Barcodes: ${barcodes.join(', ')}`);
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
        const price =
          e.price !== null && e.price !== undefined && Number(e.price) > 0
            ? ` $${Number(e.price).toFixed(2)}`
            : '';
        const added = e.purchased_date ? ` added:${e.purchased_date}` : '';
        const note = e.note ? ` note:"${e.note}"` : '';
        const photo = e.photo_file_name ? ` photo:/api/photos/${e.photo_file_name}` : '';
        lines.push(
          `- batch#${e.id}: ${fmtQty(e.amount, qu?.name, qu?.name_plural)} @ ${
            e.location_name || '?'
          }${price}${due}${added}${open}${note}${photo}`
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

    const latestPrices = new Map<number, number>();
    const priceRows = db
      .prepare(
        `SELECT ph.product_id, ph.unit_price
         FROM price_history ph
         INNER JOIN (
           SELECT product_id, MAX(id) AS max_id
           FROM price_history
           GROUP BY product_id
         ) latest ON latest.max_id = ph.id`
      )
      .all() as Array<{ product_id: number; unit_price: number }>;
    for (const pr of priceRows) {
      latestPrices.set(Number(pr.product_id), Number(pr.unit_price));
    }

    let estTotal = 0;
    let pricedCount = 0;
    const lines = items.map((i) => {
      const label = i.product_name || i.note || 'Item';
      const extraNote = i.product_name && i.note ? ` (${i.note})` : '';
      const qtyNum = Number(i.amount || 1);
      const qty = fmtQty(qtyNum, i.qu_name, i.qu_name_plural);
      const recipes =
        Array.isArray(i.recipe_names) && i.recipe_names.length > 0
          ? ` {${i.recipe_names.join(', ')}}`
          : '';
      const unitPrice = i.product_id ? latestPrices.get(Number(i.product_id)) : undefined;
      let pricePart = '';
      if (unitPrice !== undefined && unitPrice > 0) {
        const lineEst = unitPrice * qtyNum;
        if (!i.done) {
          estTotal += lineEst;
          pricedCount++;
        }
        pricePart = ` ~$${unitPrice.toFixed(2)} ea`;
      }
      const by = i.added_by_name ? ` [by ${i.added_by_name}]` : '';
      return `${i.done ? '[x]' : '[ ]'} ${label} x ${qty}${pricePart}${extraNote}${recipes}${by}`;
    });
    if (pricedCount > 0) {
      lines.push(`Estimated total (${pricedCount} priced open item${pricedCount === 1 ? '' : 's'}): ~$${estTotal.toFixed(2)}`);
    }
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

  // ─── RECIPES TOOLS (READ / WRITE / DELETE) ──────────────────
  if (name === 'list_recipes') {
    const recipes = service.listRecipes({
      sort: typeof args.sort === 'string' ? args.sort : 'urgent',
      q: typeof args.query === 'string' ? args.query : '',
    });
    if (recipes.length === 0) return textResult('No recipes found.');
    const lines = recipes.map((r) => {
      const urg =
        r.urgent_ingredient_count > 0 ? ` | urgent:${r.urgent_ingredient_count}` : '';
      const photoPart = r.photo_file_name ? ' | photo:yes' : '';
      return `#${r.id} ${r.name} | ${r.in_stock_count}/${r.total_ingredients} in stock (${r.coverage_pct}%)${urg}${
        r.tags ? ` | [${r.tags}]` : ''
      }${photoPart}`;
    });
    return textResult(lines.join('\n'));
  }

  if (name === 'get_recipe') {
    let recipe: ReturnType<InventoryService['getRecipe']> = null;
    if (typeof args.recipe_id === 'number' && args.recipe_id > 0) {
      recipe = service.getRecipe(args.recipe_id);
    } else if (typeof args.name === 'string' && args.name.trim()) {
      const matches = service.listRecipes({ q: args.name.trim() });
      recipe =
        matches.find((r) => r.name.toLowerCase() === args.name.trim().toLowerCase()) ||
        matches[0] ||
        null;
    }
    if (!recipe) return textResult('Recipe not found.', true);
    const lines: string[] = [
      `#${recipe.id} ${recipe.name} (${recipe.servings} servings${
        recipe.prep_minutes ? `, prep ${recipe.prep_minutes}m` : ''
      }${recipe.cook_minutes ? `, cook ${recipe.cook_minutes}m` : ''})`,
      `Stock: ${recipe.in_stock_count}/${recipe.total_ingredients} (${recipe.coverage_pct}%)${
        recipe.urgent_ingredient_count > 0 ? ` | ${recipe.urgent_ingredient_count} urgent/expiring` : ''
      }`,
    ];
    if (recipe.tags) lines.push(`Tags: ${recipe.tags}`);
    if (recipe.description) lines.push(`Description: ${recipe.description}`);
    if (recipe.photo_file_name) lines.push(`Photo: /api/photos/${recipe.photo_file_name}`);
    lines.push('Ingredients:');
    for (const ing of recipe.ingredients) {
      const status = ing.in_stock
        ? `IN STOCK (${ing.stock_amount}${ing.due_status !== 'fresh' && ing.due_status !== 'none' ? `, ${ing.due_status}` : ''}${
            ing.best_before_date ? `, exp ${ing.best_before_date}` : ''
          })`
        : ing.optional
        ? 'OPTIONAL (missing)'
        : 'MISSING';
      const prodTag = ing.product_id ? ` [prod #${ing.product_id}]` : '';
      lines.push(
        `- ${ing.amount}${ing.unit ? ' ' + ing.unit : ''} ${ing.ingredient_name}${
          ing.note ? ` (${ing.note})` : ''
        }${prodTag} — ${status}`
      );
    }
    if (recipe.instructions) {
      lines.push('Instructions:\n' + recipe.instructions);
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'create_recipe') {
    const photoFileName = await resolveRecipePhotoArg(service.photosDir, args, false);
    const created = service.createRecipe(
      {
        name: String(args.name || ''),
        description: typeof args.description === 'string' ? args.description : '',
        instructions: typeof args.instructions === 'string' ? args.instructions : '',
        servings: typeof args.servings === 'number' ? args.servings : 2,
        prep_minutes: typeof args.prep_minutes === 'number' ? args.prep_minutes : null,
        cook_minutes: typeof args.cook_minutes === 'number' ? args.cook_minutes : null,
        tags: typeof args.tags === 'string' ? args.tags : '',
        source_url: typeof args.source_url === 'string' ? args.source_url : '',
        photo_file_name: photoFileName ?? null,
        ingredients: Array.isArray(args.ingredients) ? args.ingredients : [],
      },
      actingUserId
    );
    const linked = created.ingredients.filter((i) => i.product_id).length;
    const photoNote = created.photo_file_name ? ', photo saved' : '';
    return textResult(
      `Created recipe #${created.id}: ${created.name} (${created.total_ingredients} ingredients, ${linked} linked to inventory, ${created.in_stock_count} in stock${photoNote})`
    );
  }

  if (name === 'update_recipe') {
    let targetId: number | null =
      typeof args.recipe_id === 'number' && args.recipe_id > 0 ? args.recipe_id : null;
    if (!targetId && typeof args.name === 'string' && args.name.trim()) {
      const row = db
        .prepare('SELECT id FROM recipes WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.name.trim()) as { id: number } | undefined;
      if (row) targetId = row.id;
    }
    if (!targetId) return textResult('Recipe not found. Provide recipe_id or exact name.', true);
    const photoFileName = await resolveRecipePhotoArg(service.photosDir, args, true);
    const updated = service.updateRecipe(
      targetId,
      {
        ...(typeof args.new_name === 'string' && args.new_name.trim()
          ? { name: args.new_name.trim() }
          : typeof args.name === 'string' && args.recipe_id
          ? { name: args.name.trim() }
          : {}),
        ...(args.description !== undefined ? { description: String(args.description) } : {}),
        ...(args.instructions !== undefined ? { instructions: String(args.instructions) } : {}),
        ...(typeof args.servings === 'number' ? { servings: args.servings } : {}),
        ...(args.prep_minutes !== undefined ? { prep_minutes: args.prep_minutes } : {}),
        ...(args.cook_minutes !== undefined ? { cook_minutes: args.cook_minutes } : {}),
        ...(args.tags !== undefined ? { tags: String(args.tags) } : {}),
        ...(args.source_url !== undefined ? { source_url: String(args.source_url) } : {}),
        ...(photoFileName !== undefined ? { photo_file_name: photoFileName } : {}),
        ...(Array.isArray(args.ingredients) ? { ingredients: args.ingredients } : {}),
      },
      actingUserId
    );
    const photoNote =
      photoFileName === null
        ? ', photo removed'
        : typeof photoFileName === 'string'
        ? ', photo updated'
        : '';
    return textResult(
      `Updated recipe #${updated.id}: ${updated.name} (${updated.in_stock_count}/${updated.total_ingredients} in stock${photoNote})`
    );
  }

  if (name === 'add_recipe_missing_to_shopping') {
    const recipeId = Number(args.recipe_id);
    if (!Number.isFinite(recipeId) || recipeId <= 0) {
      return textResult('Provide a valid recipe_id.', true);
    }
    const res = service.addRecipeMissingToShopping(recipeId, undefined, actingUserId);
    if (res.added === 0) return textResult('All required ingredients are already in stock or on the shopping list.');
    return textResult(`Added ${res.added} missing ingredient(s) to shopping list: ${res.items.join(', ')}`);
  }

  if (name === 'delete_recipe') {
    let targetId: number | null =
      typeof args.recipe_id === 'number' && args.recipe_id > 0 ? args.recipe_id : null;
    if (!targetId && typeof args.name === 'string' && args.name.trim()) {
      const row = db
        .prepare('SELECT id FROM recipes WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.name.trim()) as { id: number } | undefined;
      if (row) targetId = row.id;
    }
    if (!targetId) return textResult('Recipe not found. Provide recipe_id or exact name.', true);
    const del = service.deleteRecipe(targetId, actingUserId);
    return textResult(`Deleted recipe #${del.id}: ${del.name}`);
  }

  // ─── PRICES, RECEIPTS, STATS & STOCK TOOLS ──────────────────

  if (name === 'get_price_history') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);
    const prod = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
      | { id: number; name: string }
      | undefined;
    if (!prod) return textResult(`Product #${productId} not found.`, true);

    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(50, Math.floor(args.limit))
        : 20;
    const hist = service.getProductPriceHistory(productId);
    if (hist.count === 0) {
      return textResult(`#${prod.id} ${prod.name}: No price history recorded yet.`);
    }

    const changeStr =
      hist.price_change !== null
        ? ` | change:${hist.price_change >= 0 ? '+' : ''}$${hist.price_change.toFixed(2)} (${
            hist.price_change_pct !== null
              ? `${hist.price_change_pct >= 0 ? '+' : ''}${hist.price_change_pct}%`
              : ''
          })`
        : '';

    const lines: string[] = [
      `#${prod.id} ${prod.name} | latest:$${hist.latest_price!.toFixed(2)} | avg:$${hist.avg_price!.toFixed(2)} | min:$${hist.min_price!.toFixed(2)} | max:$${hist.max_price!.toFixed(2)}${changeStr}`,
      `History (${Math.min(limit, hist.history.length)}/${hist.count}):`,
    ];
    for (const h of hist.history.slice(0, limit)) {
      const store = h.store_name ? ` @ ${h.store_name}` : '';
      const qtyPart = h.quantity && h.quantity !== 1 ? ` (qty ${h.quantity})` : '';
      const totPart = h.total_price !== null ? ` total:$${Number(h.total_price).toFixed(2)}` : '';
      const recPart = h.receipt_id ? ` [receipt #${h.receipt_id}]` : '';
      lines.push(
        `- ${h.purchased_date} | $${Number(h.unit_price).toFixed(2)} ea${qtyPart}${totPart}${store}${recPart}`
      );
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'search_prices') {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const storeFilter = typeof args.store === 'string' ? args.store.trim().toLowerCase() : '';
    const sort = typeof args.sort === 'string' ? args.sort : 'recent';
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(100, Math.floor(args.limit))
        : 25;

    const rows = db
      .prepare(
        `SELECT ph.product_id, p.name AS product_name, ph.store_name, ph.unit_price, ph.quantity,
                ph.total_price, ph.purchased_date, ph.receipt_id
         FROM price_history ph
         INNER JOIN products p ON p.id = ph.product_id
         ORDER BY ph.purchased_date DESC, ph.id DESC`
      )
      .all() as Array<{
      product_id: number;
      product_name: string;
      store_name: string;
      unit_price: number;
      quantity: number;
      total_price: number | null;
      purchased_date: string;
      receipt_id: number | null;
    }>;

    const filtered = rows.filter((r) => {
      if (query && !r.product_name.toLowerCase().includes(query)) return false;
      if (storeFilter && !(r.store_name || '').toLowerCase().includes(storeFilter)) return false;
      return true;
    });

    // Deduplicate to latest record per (product_id, store_name)
    const deduped: typeof filtered = [];
    const seen = new Set<string>();
    for (const r of filtered) {
      const key = `${r.product_id}::${(r.store_name || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }

    if (sort === 'cheapest') {
      deduped.sort((a, b) => Number(a.unit_price) - Number(b.unit_price));
    } else if (sort === 'expensive') {
      deduped.sort((a, b) => Number(b.unit_price) - Number(a.unit_price));
    }

    if (deduped.length === 0) return textResult('No matching price records found.');

    const slice = deduped.slice(0, limit);
    const lines = slice.map(
      (r) =>
        `#${r.product_id} ${r.product_name} | $${Number(r.unit_price).toFixed(2)} ea${
          r.store_name ? ` @ ${r.store_name}` : ''
        } | ${r.purchased_date}${r.receipt_id ? ` [receipt #${r.receipt_id}]` : ''}`
    );
    if (deduped.length > slice.length) {
      lines.push(`... (${deduped.length - slice.length} more)`);
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'list_receipts') {
    const storeFilter = typeof args.store === 'string' ? args.store.trim().toLowerCase() : '';
    const days =
      typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.floor(args.days)) : null;
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(50, Math.floor(args.limit))
        : 15;

    const allReceipts = service.listReceipts(100);
    const cutoff = days ? addDaysIso(-days) : null;
    const matched = allReceipts.filter((r) => {
      if (storeFilter && !(r.store_name || '').toLowerCase().includes(storeFilter)) return false;
      if (cutoff && r.purchase_date && r.purchase_date < cutoff) return false;
      return true;
    });

    if (matched.length === 0) return textResult('No matching receipts found.');

    const totalSpend = matched.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const slice = matched.slice(0, limit);
    const lines: string[] = [
      `Receipts: ${matched.length} matched | Total spend: $${totalSpend.toFixed(2)}`,
      ...slice.map((r) => {
        const tot =
          r.total_amount !== null && r.total_amount !== undefined
            ? `$${Number(r.total_amount).toFixed(2)}`
            : 'n/a';
        const unlinked = r.unlinked_count > 0 ? ` (${r.unlinked_count} unlinked)` : '';
        return `#${r.id} ${r.purchase_date} | ${r.store_name || 'Store'} | ${tot} | ${r.item_count} items${unlinked}`;
      }),
    ];
    if (matched.length > slice.length) {
      lines.push(`... (${matched.length - slice.length} more)`);
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'get_receipt') {
    const receiptId = Number(args.receipt_id);
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      return textResult('Provide a valid receipt_id.', true);
    }
    const r = service.getReceipt(receiptId);
    if (!r) return textResult(`Receipt #${receiptId} not found.`, true);

    const moneyParts: string[] = [];
    if (r.subtotal_amount !== null && r.subtotal_amount !== undefined) {
      moneyParts.push(`subtotal:$${Number(r.subtotal_amount).toFixed(2)}`);
    }
    if (r.tax_amount !== null && r.tax_amount !== undefined) {
      moneyParts.push(`tax:$${Number(r.tax_amount).toFixed(2)}`);
    }
    if (r.total_amount !== null && r.total_amount !== undefined) {
      moneyParts.push(`total:$${Number(r.total_amount).toFixed(2)}`);
    }

    const lines: string[] = [
      `Receipt #${r.id} | ${r.store_name || 'Store'} | ${r.purchase_date}${
        moneyParts.length > 0 ? ` | ${moneyParts.join(' ')}` : ''
      }`,
    ];
    if (r.notes) lines.push(`Notes: ${r.notes}`);
    if (r.photo_file_name) lines.push(`Photo: /api/photos/${r.photo_file_name}`);
    if (Array.isArray(r.items) && r.items.length > 0) {
      lines.push(`Items (${r.items.length}):`);
      for (const it of r.items) {
        const up =
          it.unit_price !== null && it.unit_price !== undefined
            ? `$${Number(it.unit_price).toFixed(2)} ea`
            : '';
        const tp =
          it.total_price !== null && it.total_price !== undefined
            ? `total:$${Number(it.total_price).toFixed(2)}`
            : '';
        const linked = it.matched_product_id
          ? ` -> #${it.matched_product_id} ${it.matched_product_name || ''}`
          : ' [unlinked]';
        lines.push(
          `- ${it.raw_name} x${it.quantity || 1}${up ? ` | ${up}` : ''}${tp ? ` | ${tp}` : ''}${linked}`
        );
      }
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'get_stats') {
    const days =
      typeof args.days === 'number' && args.days > 0 ? Math.min(365, Math.floor(args.days)) : 30;
    const stats = service.getInventoryStats(days);
    const s = stats.summary;
    const eb = stats.expiry_buckets;
    const dh = stats.data_health;
    const w = stats.waste;

    const lines: string[] = [
      `Pantry (${days}d window): ${s.in_stock_products}/${s.total_products} products in stock | ${s.total_units} units across ${s.total_batches} batches | Value: $${Number(s.estimated_stock_value || 0).toFixed(2)}`,
      `Status: overdue:${s.overdue_count} | due_soon:${s.due_soon_count} | opened:${s.opened_count} | low_stock:${s.below_min_stock_count} | fresh:${s.fresh_count}`,
      `Expiry horizon: overdue:${eb.overdue}, 0-3d:${eb.days_0_3}, 4-7d:${eb.days_4_7}, 8-14d:${eb.days_8_14}, 15-30d:${eb.days_15_30}, 30+d:${eb.days_30_plus}, no_expiry:${eb.no_expiry}`,
      `Usage(${days}d): purchased:${w.purchased_qty} | consumed:${w.consumed_qty} | spoiled:${w.spoiled_qty} | waste_rate:${w.waste_rate_pct}%`,
      `Data health: missing_photo:${dh.missing_photo}, missing_barcode:${dh.missing_barcode}, missing_group:${dh.missing_group}, stale_90d:${dh.stale_90d}`,
    ];
    if (stats.by_store.length > 0) {
      lines.push(
        `Spend by store(${days}d): ${stats.by_store
          .map((st) => `${st.store_name}:$${Number(st.total_spent).toFixed(2)}(${st.receipt_count})`)
          .join(', ')}`
      );
    }
    if (stats.top_consumed.length > 0) {
      lines.push(
        `Top used: ${stats.top_consumed
          .slice(0, 5)
          .map((t) => `${t.name}(${t.total_used})`)
          .join(', ')}`
      );
    }
    if (w.top_spoiled.length > 0) {
      lines.push(
        `Top spoiled: ${w.top_spoiled
          .slice(0, 5)
          .map((t) => `${t.name}(${t.total_spoiled})`)
          .join(', ')}`
      );
    }
    return textResult(lines.join('\n'));
  }

  if (name === 'add_stock') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);
    const amount = typeof args.amount === 'number' && args.amount > 0 ? args.amount : 1;

    let locationId: number | undefined;
    if (typeof args.location_id === 'number' && args.location_id > 0) {
      locationId = args.location_id;
    } else if (typeof args.location_name === 'string' && args.location_name.trim()) {
      const l = db
        .prepare('SELECT id FROM locations WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.location_name.trim()) as { id: number } | undefined;
      if (!l) return textResult(`Location "${args.location_name}" not found.`, true);
      locationId = l.id;
    }

    const entry = service.purchaseProduct(
      productId,
      {
        amount,
        price: typeof args.price === 'number' && args.price >= 0 ? args.price : undefined,
        best_before_date:
          typeof args.best_before_date === 'string' && args.best_before_date.trim()
            ? args.best_before_date.trim()
            : undefined,
        location_id: locationId,
        note: typeof args.note === 'string' ? args.note.trim() : undefined,
      },
      actingUserId
    );

    const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
    const priceNote =
      typeof args.price === 'number' && args.price >= 0 ? ` @ $${args.price.toFixed(2)}` : '';
    return textResult(
      `Added ${amount} of #${productId} ${prod?.name || 'item'}${priceNote} (batch #${entry.id})`
    );
  }

  if (name === 'consume_stock') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);
    const amount = typeof args.amount === 'number' && args.amount > 0 ? args.amount : 1;
    const spoiled = Boolean(args.spoiled);

    let locationId: number | undefined;
    if (typeof args.location_id === 'number' && args.location_id > 0) {
      locationId = args.location_id;
    } else if (typeof args.location_name === 'string' && args.location_name.trim()) {
      const l = db
        .prepare('SELECT id FROM locations WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(args.location_name.trim()) as { id: number } | undefined;
      if (!l) return textResult(`Location "${args.location_name}" not found.`, true);
      locationId = l.id;
    }

    const res = service.consumeProduct(
      productId,
      { amount, spoiled, location_id: locationId },
      actingUserId
    );
    const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
    return textResult(
      `${spoiled ? 'Marked spoiled' : 'Consumed'} ${res.consumed} of #${productId} ${prod?.name || 'item'}`
    );
  }

  if (name === 'snooze_expiry') {
    const productId = resolveProductId(db, args.id, args.name);
    if (!productId) return textResult('Item not found. Provide a valid id or name.', true);
    const res = service.snoozeProductStock(
      productId,
      {
        stock_entry_id: typeof args.stock_entry_id === 'number' ? args.stock_entry_id : undefined,
        months: typeof args.months === 'number' ? args.months : undefined,
        days: typeof args.days === 'number' ? args.days : undefined,
        never_expires: Boolean(args.never_expires),
      },
      actingUserId
    );
    const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as
      | { name: string }
      | undefined;
    const newBbd = res.entries[0]?.best_before_date;
    return textResult(
      `Marked #${productId} ${prod?.name || 'item'} still good (${res.updated} batch${res.updated === 1 ? '' : 'es'} -> ${newBbd === NEVER_EXPIRES ? 'No expiry' : newBbd})`
    );
  }

  return textResult(`Unknown tool: ${name}`, true);
}
