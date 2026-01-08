import mysql from 'mysql2/promise'

let pool: mysql.Pool | null = null

export function getDbPool(): mysql.Pool {
  if (pool) {
    return pool
  }

  const host = process.env.DB_HOST || process.env.MARIADB_HOST
  const port = parseInt(process.env.DB_PORT || process.env.MARIADB_PORT || '3306')
  const user = process.env.DB_USER || process.env.MARIADB_USER
  const password = process.env.DB_PASSWORD || process.env.MARIADB_PASSWORD
  const database = process.env.DB_NAME || process.env.MARIADB_DATABASE

  if (!host || !user || !password || !database) {
    throw new Error(
      'Missing database environment variables. Please set DB_HOST (or MARIADB_HOST), DB_USER (or MARIADB_USER), DB_PASSWORD (or MARIADB_PASSWORD), and DB_NAME (or MARIADB_DATABASE)'
    )
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 20, // Increased for better concurrency
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // Performance optimizations
    multipleStatements: false, // Security: prevent SQL injection via multiple statements
    // Connection timeout settings
    connectTimeout: 10000, // 10 seconds
    // SSL configuration
    ssl: {
      rejectUnauthorized: false,
    },
  })

  return pool
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export function arrayToVectorString(arr: number[]): string {
  return `[${arr.join(',')}]`
}
