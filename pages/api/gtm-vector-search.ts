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

    const { prompt: query, chatHistory } = requestData

    if (!query) {
      throw new UserError('Missing query in request data')
    }
    
    // Extract conversation history for context (array of {query, response} objects)
    const conversationHistory = Array.isArray(chatHistory) ? chatHistory : []

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
    // For GTM documents, use similar thresholds to legal documents
    const matchThreshold = 0.70
    const matchCount = 15
    const minContentLength = 50

    // Convert embedding array to MariaDB VECTOR format string
    const embeddingVectorString = arrayToVectorString(embedding)

    // Use MariaDB native vector functions for similarity search on GTM sections
    const [gtmSectionRows] = await pool.execute(
      `WITH query_vector AS (
        SELECT Vec_FromText(?) AS vec
      )
      SELECT 
        gs.id,
        gs.gtm_id,
        gs.section_title,
        gs.content,
        gd.name as document_name,
        (1 - VEC_DISTANCE(gs.embedding, qv.vec)) AS similarity
      FROM gtm_sections gs
      JOIN gtm_documents gd ON gs.gtm_id = gd.id
      CROSS JOIN query_vector qv
      WHERE CHAR_LENGTH(gs.content) >= ?
        AND (1 - VEC_DISTANCE(gs.embedding, qv.vec)) > ?
      ORDER BY VEC_DISTANCE(gs.embedding, qv.vec) ASC
      LIMIT ?`,
      [embeddingVectorString, minContentLength, matchThreshold, matchCount]
    )

    const gtmSections = gtmSectionRows as Array<{
      id: number
      gtm_id: number
      section_title: string | null
      content: string | null
      document_name: string
      similarity: number
    }>

    const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
    let tokenCount = 0
    let contextText = ''

    for (let i = 0; i < gtmSections.length; i++) {
      const gtmSection = gtmSections[i]
      const content = gtmSection.content || ''
      const documentName = gtmSection.document_name || 'Document'
      const sectionTitle = gtmSection.section_title || 'Section'
      
      const encoded = tokenizer.encode(content)
      tokenCount += encoded.text.length

      // Increased token limit to accommodate more sections (up to 2000 tokens)
      if (tokenCount >= 2000) {
        break
      }

      // Format section with clear numbering and similarity score
      const similarityPercent = Math.round(gtmSection.similarity * 100)
      contextText += `[DOCUMENT: ${documentName}] (Relevance: ${similarityPercent}%)\nSECTION: ${sectionTitle}\n\n${content.trim()}\n\n---\n\n`
    }

    // Check if this is an introductory question
    const isIntroductoryQuestion = /^(how can you help|what can you help with|what can you do|how can i help|what do you do|tell me about yourself)/i.test(sanitizedQuery.trim())

    const prompt = codeBlock`
      ${oneLine`
        You are a Go-to-Market (GTM) Assistant - an AI assistant designed to help MariaDB sales
        professionals position MariaDB products against competitors and develop go-to-market strategies.
        The user is a MariaDB sales professional who needs help with competitive positioning,
        differentiation, and strategies to position MariaDB to customers and prospects.
        
        Your role is to provide strategic guidance, competitive insights, and positioning advice based on
        the GTM documents that have been uploaded. These documents contain information about how MariaDB
        compares to competitors and how to position MariaDB in the market.
      `}

      ${contextText ? `Go-to-Market Positioning Information:
      
      The sections below are ordered by relevance to your question (most relevant first, typically with highest similarity scores). These sections contain information about competitive positioning, differentiation strategies, and go-to-market approaches that can help you position MariaDB effectively.
      
      CRITICAL: These sections contain information that can answer the question. Sections with very high similarity scores (90%+) are HIGHLY RELEVANT and you MUST extract and use information from them to answer the question.
      
      ${contextText}

      ` : ''}Question: """
      ${sanitizedQuery}
      """

      Important: 
      ${isIntroductoryQuestion || !contextText ? `
      - If asked "how can you help", "what can you help with", "what can you do", "how can i help", "what do you do", "tell me about yourself", or similar introductory questions, respond by introducing yourself: "I'm the Go-to-Market (GTM) Assistant. I can help you with competitive positioning, differentiation strategies, and go-to-market approaches for MariaDB. I can help you understand how to position MariaDB against competitors, develop talking points for customer conversations, identify key differentiators, and create strategies to win deals."
      ` : `
      - Answer based on the information provided in the GTM documents above. The sections provided have been identified as relevant to your question.
      - Provide strategic guidance on how to position MariaDB against competitors mentioned in the documents.
      - Help develop talking points and value propositions that differentiate MariaDB from competitors.
      - When answering questions about competitors, cite specific differentiators, advantages, and positioning strategies from the documents.
      - Provide actionable go-to-market strategies and approaches based on the competitive analysis in the documents.
      - Always cite the specific document name and section when providing answers. Use formats like:
        * "According to [Document Name], Section [section title]: '[exact quote or summary]'"
        * "As stated in [Document Name]: '[exact quote or summary]'"
      - Focus on practical, actionable advice that helps sales professionals win deals and position MariaDB effectively.
      - If multiple competitors are mentioned in the documents, help identify which competitive positioning is most relevant to the question.
      - Help structure responses as talking points that can be used in customer conversations.
      - Provide guidance on how to handle competitive objections and position MariaDB's strengths.
      `}
      - Use markdown formatting for better readability.
      - Format quotes using blockquotes (> ) or quotation marks for emphasis.
      - If you don't have specific information in the GTM documents, acknowledge that and suggest what information would be helpful to upload.

      Answer as markdown (be helpful, strategic, and focused on competitive positioning):
    `

    const chatMessage: ChatCompletionRequestMessage = {
      role: 'user',
      content: prompt,
    }

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [chatMessage],
      max_tokens: 1024,
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
      const usedSections = gtmSections.slice(0, gtmSections.length).map(section => ({
        id: section.id,
        document_name: section.document_name,
        section_title: section.section_title,
        similarity: Math.round(section.similarity * 100) / 100
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
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      console.error(err)
    }

    return res.status(500).json({
      error: 'There was an error processing your request',
    })
  }
}

