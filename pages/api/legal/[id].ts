import type { NextApiRequest, NextApiResponse } from 'next'
import { getDbPool } from '@/lib/db'
import { ApplicationError } from '@/lib/errors'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pool = getDbPool()
    const { id } = req.query

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid legal document ID' })
    }

    const legalId = parseInt(id, 10)

    if (isNaN(legalId)) {
      return res.status(400).json({ error: 'Invalid legal document ID' })
    }

    if (req.method === 'DELETE') {
      // Delete legal document (cascade will delete legal_sections)
      await pool.execute('DELETE FROM legal_documents WHERE id = ?', [legalId])

      return res.status(200).json({ success: true, message: 'Legal document deleted successfully' })
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

