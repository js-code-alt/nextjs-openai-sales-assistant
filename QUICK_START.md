# Quick Start Guide - After Migration

## ✅ Migration Complete!

Your MariaDB database is now set up with:
- `nods_page` table
- `nods_page_section` table with VECTOR(1536) column
- Vector index for similarity search

## Next Steps:

### 1. Verify the Migration (Optional but Recommended)

Check that the tables were created:
```bash
mysql -h serverless-europe-west9.sysp0000.db2.skysql.com -P 4074 -u dbpgf40477959 -p --ssl --ssl-verify-server-cert=false jonas-schwegler-gi1w -e "SHOW TABLES;"
```

You should see:
```
+--------------------------------+
| Tables_in_jonas-schwegler-gi1w |
+--------------------------------+
| nods_page                      |
| nods_page_section              |
+--------------------------------+
```

Check the vector index:
```bash
mysql -h serverless-europe-west9.sysp0000.db2.skysql.com -P 4074 -u dbpgf40477959 -p --ssl --ssl-verify-server-cert=false jonas-schwegler-gi1w -e "SHOW INDEXES FROM nods_page_section;"
```

### 2. Install Dependencies

If you haven't already:
```bash
pnpm install
```

Or with npm:
```bash
npm install
```

### 3. Generate Embeddings

Process your `.mdx` documentation files and store embeddings in the database:

```bash
pnpm run embeddings
```

Or:
```bash
npm run embeddings
```

This will:
- Find all `.mdx` files in the `pages` directory
- Generate embeddings using OpenAI
- Store them in your MariaDB database

### 4. Start the Development Server

```bash
pnpm dev
```

Or:
```bash
npm run dev
```

Then visit: **http://localhost:3000**

### 5. Test Your Application!

- Press `⌘K` (or click the search box) to open the search dialog
- Ask a question about your documentation
- The app will use vector search to find relevant content and generate answers!

## Troubleshooting

### "Command not found: pnpm"
Install pnpm first:
```bash
corepack enable && corepack prepare pnpm@latest --activate
```
Or use `npm` instead.

### "Missing database environment variables"
Make sure your `.env` file has:
- `DB_HOST` (or `MARIADB_HOST`)
- `DB_PORT` (or `MARIADB_PORT`)
- `DB_USER` (or `MARIADB_USER`)
- `DB_PASSWORD` (or `MARIADB_PASSWORD`)
- `DB_NAME` (or `MARIADB_DATABASE`)
- `OPENAI_KEY`

### "Failed to connect to database"
- Verify your MariaDB credentials in `.env` are correct
- Check that SSL is enabled if required
- Verify your IP is allowed in SkySQL firewall settings

