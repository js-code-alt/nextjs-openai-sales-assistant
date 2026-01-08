# Setup Guide - MariaDB Migration

## Step 1: Install Dependencies

First, you need to install the project dependencies. The project now uses `mysql2` instead of `@supabase/supabase-js`.

### Install pnpm (if not already installed):

**Option 1: Using corepack (recommended - comes with Node.js):**
```bash
corepack enable
corepack prepare pnpm@latest --activate
```

**Option 2: Using npm:**
```bash
npm install -g pnpm
```

**Option 3: Using Homebrew (macOS):**
```bash
brew install pnpm
```

### Install project dependencies:
```bash
pnpm install
```

Or if you prefer npm:
```bash
npm install
```

---

## Step 2: Configure Environment Variables

Make sure your `.env` file has the following variables:

```env
# OpenAI API Key
OPENAI_KEY=your-openai-key

# MariaDB Cloud Credentials (use either DB_* or MARIADB_* prefix)
DB_HOST=your-mariadb-host
DB_PORT=3306
DB_USER=your-mariadb-user
DB_PASSWORD=your-mariadb-password
DB_NAME=your-mariadb-database
```

**OR:**
```env
MARIADB_HOST=your-mariadb-host
MARIADB_PORT=3306
MARIADB_USER=your-mariadb-user
MARIADB_PASSWORD=your-mariadb-password
MARIADB_DATABASE=your-mariadb-database
```

---

## Step 3: Run the Database Migration

Run the migration script against your MariaDB Cloud database to create the necessary tables and vector index.

### Using mysql command line:
```bash
mysql -h your-host -u your-user -p your-database < migrations/init.sql
```

You'll be prompted for your password.

### Using a database client:
1. Connect to your MariaDB Cloud database
2. Open the file `migrations/init.sql`
3. Execute the SQL script

### Important:
- Make sure your MariaDB instance is **version 11.7 or later** (required for native VECTOR support)
- Verify the migration worked by checking if the tables were created:
  ```sql
  SHOW TABLES;
  -- Should show: nods_page and nods_page_section
  
  SHOW INDEXES FROM nods_page_section;
  -- Should show idx_embedding with type VECTOR
  ```

---

## Step 4: Generate Embeddings

After the database is set up, generate embeddings for your documentation files:

```bash
pnpm run embeddings
```

Or:
```bash
npm run embeddings
```

This will:
- Process all `.mdx` files in the `pages` directory
- Generate embeddings using OpenAI
- Store them in your MariaDB database with vector indexes

---

## Step 5: Start the Development Server

```bash
pnpm dev
```

Or:
```bash
npm run dev
```

Visit `http://localhost:3000` to test your application!

---

## Troubleshooting

### "MariaDB Vector support not available"
- Make sure your MariaDB Cloud instance is version 11.7 or later
- Check with: `SELECT VERSION();`

### "Command not found: pnpm"
- Follow the pnpm installation instructions above
- Or use `npm` instead: `npm install`, `npm run embeddings`, etc.

### "Missing database environment variables"
- Verify your `.env` file has all required database credentials
- Make sure you're using either `DB_*` or `MARIADB_*` prefix consistently

