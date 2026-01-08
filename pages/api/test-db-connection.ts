import type { NextApiRequest, NextApiResponse } from 'next'
import { getDbPool } from '@/lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Check environment variables
    const host = process.env.DB_HOST || process.env.MARIADB_HOST
    const port = process.env.DB_PORT || process.env.MARIADB_PORT || '3306'
    const user = process.env.DB_USER || process.env.MARIADB_USER
    const password = process.env.DB_PASSWORD || process.env.MARIADB_PASSWORD
    const database = process.env.DB_NAME || process.env.MARIADB_DATABASE

    const envCheck = {
      host: host ? '✓ Set' : '✗ Missing',
      port: port ? `✓ Set (${port})` : '✗ Missing',
      user: user ? '✓ Set' : '✗ Missing',
      password: password ? '✓ Set' : '✗ Missing',
      database: database ? '✓ Set' : '✗ Missing',
    }

    if (!host || !user || !password || !database) {
      return res.status(400).json({
        connected: false,
        error: 'Missing database environment variables',
        environment: envCheck,
      })
    }

    // Try to get connection pool
    const pool = getDbPool()

    // Test connection with a simple query
    // Use backticks for aliases to avoid reserved keyword issues
    const [versionRows] = await pool.execute('SELECT VERSION() as `version`')
    const [databaseRows] = await pool.execute('SELECT DATABASE() as `database`')
    const [userRows] = await pool.execute('SELECT USER() as `user`')

    const versionResult = versionRows as Array<{ version: string }>
    const databaseResult = databaseRows as Array<{ database: string | null }>
    const userResult = userRows as Array<{ user: string }>

    // Check if vector support is available (MariaDB 11.7+)
    let vectorSupport = false
    let vectorSupportError = null
    try {
      await pool.execute('SELECT VEC_DISTANCE(Vec_FromText("[1,2,3]"), Vec_FromText("[1,2,3]")) as test')
      vectorSupport = true
    } catch (err: any) {
      vectorSupportError = err.message
    }

    // Check if required tables exist
    const [tables] = await pool.execute(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('products', 'product_sections')",
      [database]
    )

    const tableRows = tables as Array<{ TABLE_NAME: string }>
    const tablesExist = {
      products: tableRows.some((t) => t.TABLE_NAME === 'products'),
      product_sections: tableRows.some((t) => t.TABLE_NAME === 'product_sections'),
    }

    return res.status(200).json({
      connected: true,
      message: 'Successfully connected to MariaDB Cloud',
      database: {
        version: versionResult[0]?.version || 'Unknown',
        current_database: databaseResult[0]?.database || 'Unknown',
        current_user: userResult[0]?.user || 'Unknown',
      },
      environment: envCheck,
      vectorSupport: {
        available: vectorSupport,
        error: vectorSupportError,
      },
      tables: tablesExist,
    })
  } catch (err: any) {
    return res.status(500).json({
      connected: false,
      error: 'Failed to connect to database',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    })
  }
}

