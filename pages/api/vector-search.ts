import type { NextApiRequest, NextApiResponse } from 'next'
import { codeBlock, oneLine } from 'common-tags'
import GPT3Tokenizer from 'gpt3-tokenizer'
import {
  Configuration,
  OpenAIApi,
  CreateModerationResponse,
  CreateEmbeddingResponse,
  ChatCompletionRequestMessage,
} from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { ApplicationError, UserError } from '@/lib/errors'
import { getDbPool, arrayToVectorString } from '@/lib/db'

const openAiKey = process.env.OPENAI_KEY

const config = new Configuration({
  apiKey: openAiKey,
})
const openai = new OpenAIApi(config)

// Note: Using Node.js runtime instead of edge runtime because mysql2 requires Node.js modules
// export const runtime = 'edge'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!openAiKey) {
      throw new ApplicationError('Missing environment variable OPENAI_KEY')
    }

    const dbHost = process.env.DB_HOST || process.env.MARIADB_HOST
    const dbUser = process.env.DB_USER || process.env.MARIADB_USER
    const dbPassword = process.env.DB_PASSWORD || process.env.MARIADB_PASSWORD
    const dbName = process.env.DB_NAME || process.env.MARIADB_DATABASE

    if (!dbHost || !dbUser || !dbPassword || !dbName) {
      throw new ApplicationError(
        'Missing database environment variables. Please set DB_HOST (or MARIADB_HOST), DB_USER (or MARIADB_USER), DB_PASSWORD (or MARIADB_PASSWORD), and DB_NAME (or MARIADB_DATABASE)'
      )
    }

    // Handle only POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const requestData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

    if (!requestData) {
      throw new UserError('Missing request data')
    }

    const { prompt: query } = requestData

    if (!query) {
      throw new UserError('Missing query in request data')
    }

    const pool = getDbPool()

    // Moderate the content to comply with OpenAI T&C
    const sanitizedQuery = query.trim()
    
    // Run moderation and embedding generation in parallel for better performance
    const [moderationResponse, embeddingResponse] = await Promise.all([
      openai.createModeration({ input: sanitizedQuery }).then((res) => res.json()),
      openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: sanitizedQuery.replaceAll('\n', ' '),
      }),
    ])

    const [results] = moderationResponse.results

    if (results.flagged) {
      throw new UserError('Flagged content', {
        flagged: true,
        categories: results.categories,
      })
    }

    if (embeddingResponse.status !== 200) {
      throw new ApplicationError('Failed to create embedding for question', embeddingResponse)
    }

    const {
      data: [{ embedding }],
    }: CreateEmbeddingResponse = await embeddingResponse.json()

    // Use MariaDB's native vector search functions
    const matchThreshold = 0.78
    const matchCount = 10
    const minContentLength = 50

    // Convert embedding array to MariaDB VECTOR format string
    const embeddingVectorString = arrayToVectorString(embedding)

    // Use MariaDB native vector functions for similarity search on product sections
    // Optimized query: Use CTE to compute Vec_FromText once and reuse it
    // Since the index is configured with DISTANCE=cosine, VEC_DISTANCE() will use cosine distance
    // VEC_DISTANCE returns cosine distance (lower = more similar, 0 = identical)
    // Cosine similarity = 1 - cosine distance (for display/threshold purposes)
    const [productSectionRows] = await pool.execute(
      `WITH query_vector AS (
        SELECT Vec_FromText(?) AS vec
      )
      SELECT 
        ps.id,
        ps.product_id,
        ps.section_title,
        ps.content,
        p.name as product_name,
        (1 - VEC_DISTANCE(ps.embedding, qv.vec)) AS similarity
      FROM product_sections ps
      JOIN products p ON ps.product_id = p.id
      CROSS JOIN query_vector qv
      WHERE CHAR_LENGTH(ps.content) >= ?
        AND (1 - VEC_DISTANCE(ps.embedding, qv.vec)) > ?
      ORDER BY VEC_DISTANCE(ps.embedding, qv.vec) ASC
      LIMIT ?`,
      [embeddingVectorString, minContentLength, matchThreshold, matchCount]
    )

    const productSections = productSectionRows as Array<{
      id: number
      product_id: number
      section_title: string | null
      content: string | null
      product_name: string
      similarity: number
    }>

    const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
    let tokenCount = 0
    let contextText = ''

    for (let i = 0; i < productSections.length; i++) {
      const productSection = productSections[i]
      const content = productSection.content || ''
      const productName = productSection.product_name || 'Product'
      const sectionTitle = productSection.section_title || 'Section'
      
      const encoded = tokenizer.encode(content)
      tokenCount += encoded.text.length

      if (tokenCount >= 1500) {
        break
      }

      contextText += `Product: ${productName}\nSection: ${sectionTitle}\n${content.trim()}\n---\n`
    }

    const prompt = codeBlock`
      ${oneLine`
        You are the MariaDB Sales Assistant - an AI assistant designed to help MariaDB sales
        professionals position and sell MariaDB products to customers. The user asking questions
        is a MariaDB sales professional who needs your help with sales conversations, positioning,
        and communicating value to prospects and customers (like CTOs, IT directors, etc.).
        
        Your role is to provide sales guidance, talking points, and positioning advice based on
        the product information. When answering questions, frame your responses as sales advice
        for the salesperson - tell them HOW to explain things to their customers, what talking
        points to use, how to position features as benefits, and how to address customer concerns.
        
        DO NOT explain MariaDB products to the salesperson as if they are a customer. Instead,
        help them sell by providing:
        - Sales talking points and value propositions
        - How to position features for different customer personas (CTOs, developers, etc.)
        - Answers to common customer objections
        - Competitive positioning and differentiation
        - Use cases and customer success stories
        - How to structure sales conversations and calls
        
        Given the following sections from product information, answer the question using only
        that information, outputted in markdown format. Frame your responses as sales guidance
        for the salesperson. If you are unsure and the answer is not explicitly written in the
        product information, say "I don't have that information in the product database. Please
        check the MariaDB documentation or contact the product team."
      `}

      Product Information:
      ${contextText}

      Question: """
      ${sanitizedQuery}
      """

      Important: 
      - Remember - the user is a MariaDB sales professional. Provide them with sales guidance, talking points, and positioning advice to help them sell to their customers. Frame responses as "here's how you can explain/position this to your customer" or "here's a plan/approach for your sales call" rather than explaining products to the salesperson.
      
      - If asked "how can you help", "what can you help with", "how can i help", or similar introductory questions, respond by introducing yourself: "I'm the MariaDB Sales Assistant. I can help you with product questions, positioning products for sales conversations, help with prospecting, and general MariaDB questions. I'm here to support you in your sales efforts by providing talking points, value propositions, competitive positioning, and guidance on how to effectively communicate with prospects and customers."

      Answer as markdown (be helpful, accurate, and focused on providing actionable sales guidance):
    `

    const chatMessage: ChatCompletionRequestMessage = {
      role: 'user',
      content: prompt,
    }

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [chatMessage],
      max_tokens: 512,
      temperature: 0,
      stream: true,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new ApplicationError('Failed to generate completion', error)
    }

    // Transform the response into a readable stream
    const stream = OpenAIStream(response)
    
    // Set headers for streaming text that useCompletion expects
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    
    // Pipe the stream directly to the response
    // OpenAIStream already formats the chunks correctly for useCompletion
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        res.write(chunk)
        // Flush the response to ensure chunks are sent immediately
        if (typeof (res as any).flush === 'function') {
          (res as any).flush()
        }
      }
      
      // Send sources metadata at the end
      // Only include sections that were actually used in the context (limited by token count)
      const usedSections = productSections.slice(0, productSections.length).map(section => ({
        id: section.id,
        product_name: section.product_name,
        section_title: section.section_title,
        similarity: Math.round(section.similarity * 100) / 100 // Round to 2 decimal places
      }))
      
      // Append sources as JSON (separated by a delimiter)
      res.write(`\n\n__SOURCES__:${JSON.stringify(usedSections)}`)
      res.end()
    } catch (streamErr) {
      console.error('Stream error:', streamErr)
      res.end()
    }
    
    return
  } catch (err: unknown) {
    if (err instanceof UserError) {
      return res.status(400).json({
        error: err.message,
        data: err.data,
      })
    } else if (err instanceof ApplicationError) {
      // Print out application errors with their additional data
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      // Print out unexpected errors as is to help with debugging
      console.error(err)
    }

    // TODO: include more response info in debug environments
    return res.status(500).json({
      error: 'There was an error processing your request',
    })
  }
}
