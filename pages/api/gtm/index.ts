import type { NextApiRequest, NextApiResponse } from 'next'
import { getDbPool } from '@/lib/db'
import { ApplicationError } from '@/lib/errors'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pool = getDbPool()

    if (req.method === 'GET') {
      const [rows] = await pool.execute(
        'SELECT id, name, description, created_at FROM gtm_documents ORDER BY created_at DESC'
      )

      return res.status(200).json(rows)
    } else {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (err: unknown) {
    if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      console.error(err)
    }

    return res.status(500).json({
      error: 'There was an error processing your request',
    })
  }
}

