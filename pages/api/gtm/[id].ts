import type { NextApiRequest, NextApiResponse } from 'next'
import { getDbPool } from '@/lib/db'
import { ApplicationError } from '@/lib/errors'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pool = getDbPool()
    const { id } = req.query

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid GTM document ID' })
    }

    const gtmId = parseInt(id, 10)

    if (isNaN(gtmId)) {
      return res.status(400).json({ error: 'Invalid GTM document ID' })
    }

    if (req.method === 'DELETE') {
      // Delete GTM document (cascade will delete gtm_sections)
      await pool.execute('DELETE FROM gtm_documents WHERE id = ?', [gtmId])

      return res.status(200).json({ success: true, message: 'GTM document deleted successfully' })
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

