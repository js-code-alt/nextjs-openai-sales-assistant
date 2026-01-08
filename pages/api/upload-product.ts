import type { NextApiRequest, NextApiResponse } from 'next'
import { getDbPool, arrayToVectorString } from '@/lib/db'
import { ApplicationError, UserError } from '@/lib/errors'
import { Configuration, OpenAIApi } from 'openai'
import formidable from 'formidable'
import fs from 'fs'
import pdfParse from 'pdf-parse'

const openAiKey = process.env.OPENAI_KEY

const openAiConfig = new Configuration({
  apiKey: openAiKey,
})
const openai = new OpenAIApi(openAiConfig)

// Note: Next.js Pages Router doesn't parse multipart/form-data automatically,
// so formidable can handle the raw request stream
async function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB for files
      keepExtensions: true,
      maxFields: 10,
      // Don't set maxFieldsSize - it limits the total size of all fields combined
      // Our product name field is small, so we don't need this limit
    })

    form.parse(req, (err, fields, files) => {
      if (err) {
        // Handle specific formidable errors
        if (err.message?.includes('exceeded')) {
          reject(new UserError(`File too large. Maximum size is 50MB. ${err.message}`))
        } else {
          reject(new UserError(`Error parsing form: ${err.message || 'Unknown error'}`))
        }
      } else {
        resolve({ fields, files })
      }
    })
  })
}

async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath)
  const data = await pdfParse(dataBuffer)
  return data.text
}

// Disable body parsing for this route to allow formidable to handle multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!openAiKey) {
      throw new ApplicationError('Missing environment variable OPENAI_KEY')
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    let name: string
    let content: string

    // Check if it's a multipart/form-data request (file upload)
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      let fields: formidable.Fields
      let files: formidable.Files
      
      try {
        const parsed = await parseForm(req)
        fields = parsed.fields
        files = parsed.files
      } catch (parseError: any) {
        // Handle formidable parsing errors
        if (parseError instanceof UserError) {
          throw parseError
        }
        const errorMsg = parseError?.message || 'Error parsing form data'
        if (errorMsg.includes('exceeded') || errorMsg.includes('maxFileSize')) {
          throw new UserError('File too large. Maximum file size is 50MB. Please try a smaller file.')
        }
        throw new UserError(`Error processing file upload: ${errorMsg}`)
      }
      
      name = Array.isArray(fields.name) ? fields.name[0] : fields.name
      
      // Handle file upload
      const fileField = files.file
      if (fileField) {
        const file = Array.isArray(fileField) ? fileField[0] : fileField
        const filePath = file.filepath
        
        // Check if it's a PDF
        if (file.mimetype === 'application/pdf' || file.originalFilename?.toLowerCase().endsWith('.pdf')) {
          content = await extractTextFromPDF(filePath)
          // Clean up temp file
          fs.unlinkSync(filePath)
        } else {
          // For text files, read as text
          content = fs.readFileSync(filePath, 'utf-8')
          // Clean up temp file
          fs.unlinkSync(filePath)
        }
      } else if (fields.content) {
        // Fallback to text content field
        content = Array.isArray(fields.content) ? fields.content[0] : fields.content
      } else {
        throw new UserError('No file or content provided')
      }
    } else {
      // Handle JSON request (text-only)
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      name = body.name
      content = body.content
    }

    if (!name || !content) {
      throw new UserError('Missing required fields: name and content')
    }

    const pool = getDbPool()

    // Create product
    const [insertResult] = await pool.execute(
      'INSERT INTO products (name, description) VALUES (?, ?)',
      [name, content.substring(0, 500)] // Store first 500 chars as description
    )
    const insertResultArray = insertResult as { insertId: number }
    const productId = insertResultArray.insertId

    // Split content into sections (by paragraphs for now)
    const sections = content
      .split(/\n\s*\n/)
      .map((section: string) => section.trim())
      .filter((section: string) => section.length > 50) // Minimum 50 chars per section

    if (sections.length === 0) {
      // If no sections found, use the whole content as one section
      sections.push(content.trim())
    }

    console.log(`[Product: ${name}] Creating ${sections.length} sections with embeddings`)

    // Generate embeddings for each section
    for (const [index, section] of sections.entries()) {
      try {
        // OpenAI recommends replacing newlines with spaces for best results
        const input = section.replace(/\n/g, ' ')

        const embeddingResponse = await openai.createEmbedding({
          model: 'text-embedding-ada-002',
          input,
        })

        if (embeddingResponse.status !== 200) {
          throw new Error(`Failed to create embedding: ${embeddingResponse.statusText}`)
        }

        const {
          data: [{ embedding }],
        } = embeddingResponse.data

        // Extract a title from the section (first line or first 100 chars)
        const sectionTitle = section.split('\n')[0].substring(0, 500) || `Section ${index + 1}`

        // Convert embedding array to MariaDB VECTOR format string
        const embeddingVectorString = arrayToVectorString(embedding)

        await pool.execute(
          'INSERT INTO product_sections (product_id, content, section_title, token_count, embedding) VALUES (?, ?, ?, ?, Vec_FromText(?))',
          [
            productId,
            section,
            sectionTitle,
            embeddingResponse.data.usage.total_tokens,
            embeddingVectorString,
          ]
        )
      } catch (err) {
        console.error(`Failed to generate embeddings for section ${index + 1}:`, err)
        throw err
      }
    }

    return res.status(200).json({
      success: true,
      productId,
      sectionsCount: sections.length,
      message: 'Product uploaded and embeddings generated successfully',
    })
  } catch (err: unknown) {
    // Ensure we always return JSON, never plain text
    if (err instanceof UserError) {
      return res.status(400).json({
        error: err.message,
        data: err.data,
      })
    } else if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
      return res.status(500).json({
        error: err.message,
        data: err.data,
      })
    } else {
      console.error('Upload error:', err)
      const errorMessage = err instanceof Error ? err.message : 'There was an error processing your request'
      
      // Handle formidable/parsing errors
      if (errorMessage.includes('exceeded') || errorMessage.includes('maxFileSize')) {
        return res.status(400).json({
          error: 'File too large. Maximum file size is 50MB. Please try a smaller file.',
        })
      }
      
      return res.status(500).json({
        error: errorMessage,
      })
    }
  }
}
