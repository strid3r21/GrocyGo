# GrocyGo Server

Lightweight, self-hosted **Food Inventory & Shopping List** server with **Product + Shelf Photos**, a calm minimal Web UI, and a built-in token-efficient **Read-Only MCP Server** for AI agents.

- **Zero runtime npm dependencies** (TypeScript + Node 24 built-in `node:sqlite`)
- **Grocy-compatible REST API** for stock, locations, products, barcodes, and shopping lists
- **Dual Photos**: stores both a **Product Photo** (the item itself) and a **Storage/Shelf Photo** (where it's stored on the shelf, per batch or product), both updatable anytime
- **Original Grocy Importer**: migrate seamlessly via live Grocy API (including product photos!) or by uploading your existing `grocy.db` SQLite file
- **Scannable API Key QR Codes**: generate offline QR codes right from the **API & MCP** tab to connect the GrocyGo mobile app in one scan
- **Built-in Read-Only MCP Server (`/mcp`)** with ultra-compact 1-line-per-item responses (~85–90% fewer tokens than raw JSON)

---

## Install on Unraid (Docker Template)

1. Open the **Unraid Terminal** (`>_` icon in the top-right bar) and download the template:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/strid3r21/GrocyGo/main/unraid/grocygo.xml \
     -o /boot/config/plugins/dockerMan/templates-user/my-grocygo.xml
   ```
2. In the Unraid WebUI, go to **Docker** → **Add Container** → click **Select a template** → choose **grocygo**.
3. Adjust the port (`9283`), appdata path (`/mnt/user/appdata/grocygo`), timezone, and optional `INITIAL_API_KEY`, then click **Apply**.
4. Open the container **Logs** on first boot to copy your generated API key (unless you set `INITIAL_API_KEY`).

---

## Quick Start (Docker Compose)

```bash
docker compose up -d --build
docker compose logs -f
```

Or pull the prebuilt multi-arch image (`linux/amd64` & `linux/arm64`):
```bash
docker run -d --name grocygo \
  -p 9283:9283 \
  -v $(pwd)/data:/data \
  ghcr.io/strid3r21/grocygo:latest
```

- **Web UI & REST API:** `http://<host>:9283`
- **MCP Endpoint:** `http://<host>:9283/mcp`
- **Persistent Data (SQLite DB + Photos):** `/data`

---

## Connecting AI Agents via MCP

```json
{
  "mcpServers": {
    "grocygo": {
      "url": "https://your-grocygo-host/mcp",
      "headers": {
        "GROCY-API-KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Included MCP Tools (Read-Only)
- `inventory_summary` — compact pantry overview (stock count, locations, expiring/overdue, open shopping count)
- `search_inventory` — filter by `query`, `location`, `status` (`all | due_soon | overdue | low`), `limit`
- `get_item` — detailed per-batch breakdown with locations, expiry, notes, and product/shelf photo paths
- `list_locations` — storage locations with item counts and freezer indicator
- `get_shopping_list` — compact shopping list (`include_done` defaults to `false`)

## Local Development & Tests

```bash
npm install
npm test
npm start
```
