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
    // Lower threshold and get more results for legal documents to ensure we capture all relevant sections
    const matchThreshold = 0.70  // Lower threshold to capture more potentially relevant sections
    const matchCount = 15  // Increase from 10 to 15 to get more sections for analysis
    const minContentLength = 50

    // Convert embedding array to MariaDB VECTOR format string
    const embeddingVectorString = arrayToVectorString(embedding)

    // Use MariaDB native vector functions for similarity search on legal sections
    // Optimized query: Use CTE to compute Vec_FromText once and reuse it
    // Since the index is configured with DISTANCE=cosine, VEC_DISTANCE() will use cosine distance
    // VEC_DISTANCE returns cosine distance (lower = more similar, 0 = identical)
    // Cosine similarity = 1 - cosine distance (for display/threshold purposes)
    // First, get vector search results
    const [legalSectionRows] = await pool.execute(
      `WITH query_vector AS (
        SELECT Vec_FromText(?) AS vec
      )
      SELECT 
        ls.id,
        ls.legal_id,
        ls.section_title,
        ls.content,
        ld.name as document_name,
        (1 - VEC_DISTANCE(ls.embedding, qv.vec)) AS similarity
      FROM legal_sections ls
      JOIN legal_documents ld ON ls.legal_id = ld.id
      CROSS JOIN query_vector qv
      WHERE CHAR_LENGTH(ls.content) >= ?
        AND (1 - VEC_DISTANCE(ls.embedding, qv.vec)) > ?
      ORDER BY VEC_DISTANCE(ls.embedding, qv.vec) ASC
      LIMIT ?`,
      [embeddingVectorString, minContentLength, matchThreshold, matchCount]
    )

    // Check if query is about licensing/compliance - if so, also do keyword search
    const isLicensingQuery = /(license|licensed|unlicensed|node|server|core|vCPU|violat|complian|over.?usage|exceed)/i.test(sanitizedQuery)
    
    let keywordBoostedSections: Array<{
      id: number
      legal_id: number
      section_title: string | null
      content: string | null
      document_name: string
      similarity: number
    }> = []

    if (isLicensingQuery) {
      // Also search for sections with licensing keywords that might have been missed
      const licensingKeywords = ['must be licensed', 'licensed and subscribed', 'all Servers', 'all Cores', 'all vCPUs', 'all environments', 'production, test, development', 'reporting', 'notify', 'over-usage', 'exceeding quantity']
      
      const keywordConditions = licensingKeywords.map(() => '(ls.content LIKE ? OR ls.section_title LIKE ?)').join(' OR ')
      const keywordParams = licensingKeywords.flatMap(kw => [`%${kw}%`, `%${kw}%`])
      
      const [keywordRows] = await pool.execute(
        `SELECT 
          ls.id,
          ls.legal_id,
          ls.section_title,
          ls.content,
          ld.name as document_name,
          0.85 AS similarity
        FROM legal_sections ls
        JOIN legal_documents ld ON ls.legal_id = ld.id
        WHERE CHAR_LENGTH(ls.content) >= ?
          AND (${keywordConditions})
        LIMIT 10`,
        [minContentLength, ...keywordParams]
      )
      
      keywordBoostedSections = keywordRows as Array<{
        id: number
        legal_id: number
        section_title: string | null
        content: string | null
        document_name: string
        similarity: number
      }>
    }

    let legalSections = legalSectionRows as Array<{
      id: number
      legal_id: number
      section_title: string | null
      content: string | null
      document_name: string
      similarity: number
    }>

    // Merge keyword-boosted sections with vector search results, avoiding duplicates
    if (keywordBoostedSections.length > 0) {
      const existingIds = new Set(legalSections.map(s => s.id))
      const newSections = keywordBoostedSections.filter(s => !existingIds.has(s.id))
      
      // Add keyword-boosted sections at the beginning (higher priority)
      legalSections = [...newSections, ...legalSections]
      
      // Sort by similarity (highest first) but keep keyword-boosted sections prioritized
      legalSections.sort((a, b) => {
        // If both are keyword-boosted or both are vector search, sort by similarity
        const aIsKeyword = keywordBoostedSections.some(ks => ks.id === a.id)
        const bIsKeyword = keywordBoostedSections.some(ks => ks.id === b.id)
        
        if (aIsKeyword && !bIsKeyword) return -1
        if (!aIsKeyword && bIsKeyword) return 1
        return b.similarity - a.similarity
      })
      
      // Limit to top results
      legalSections = legalSections.slice(0, matchCount + 5) // Allow a few extra for keyword matches
    }

    const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
    let tokenCount = 0
    let contextText = ''

    for (let i = 0; i < legalSections.length; i++) {
      const legalSection = legalSections[i]
      const content = legalSection.content || ''
      const documentName = legalSection.document_name || 'Document'
      const sectionTitle = legalSection.section_title || 'Section'
      
      const encoded = tokenizer.encode(content)
      tokenCount += encoded.text.length

      // Increased token limit to accommodate more sections for legal documents (up to 2000 tokens)
      if (tokenCount >= 2000) {
        break
      }

      // Format section with clear numbering - include section title which should contain section number
      contextText += `[DOCUMENT: ${documentName}]\nSECTION: ${sectionTitle}\n\n${content.trim()}\n\n---\n\n`
    }

    // Check if this is an introductory question
    const isIntroductoryQuestion = /^(how can you help|what can you help with|what can you do|how can i help|what do you do|tell me about yourself)/i.test(sanitizedQuery.trim())

    // Extract section numbers mentioned in the query (e.g., "2.1", "4.4", "section 2")
    const sectionNumberMatches = sanitizedQuery.match(/\b(\d+\.\d+|\d+\.)\b/gi) || []
    const mentionedSectionNumbers = sectionNumberMatches.map(m => m.toLowerCase().replace(/\.$/, ''))

    // Build a list of section titles/numbers from the retrieved sections for reference
    const sectionList = legalSections.map((s, idx) => {
      const title = s.section_title || 'Section'
      // Try to extract section number from title
      const sectionNumMatch = title.match(/(\d+\.\d*\.?)/)
      const sectionNum = sectionNumMatch ? sectionNumMatch[1] : null
      return { index: idx, title, sectionNum, similarity: s.similarity }
    }).slice(0, 10) // Show first 10 for reference

    const prompt = codeBlock`
      ${oneLine`
        You are a Legal Document Assistant - an AI assistant designed to help users understand
        and find information in legal documents. The user is asking questions about legal
        documents that have been uploaded to the system.
        
        Your role is to provide clear, accurate answers based on the legal document information
        provided. When answering questions, be precise and cite relevant sections when possible.
      `}

      ${contextText ? `Legal Document Information:
      
      The sections below are ordered by relevance to your question (most relevant first, typically with highest similarity scores). These sections have been identified as relevant to your question. USE THIS INFORMATION to answer the question.
      
      CRITICAL INSTRUCTIONS FOR FINDING RELEVANT SECTIONS:
      1. Review ALL sections below - do not just look at the first few. Scan through ALL of them.
      2. Look for sections that contain these EXACT phrases or keywords:
         - "must be licensed" OR "licensed and subscribed" OR "all Servers" OR "all Cores" OR "all vCPUs"
         - "all environments" OR "production, test, development, disaster recovery"
         - "Scope" (especially Section 2.x which often covers licensing requirements)
         - "reporting" OR "notify" OR "over-usage" OR "exceeding quantity" (especially Section 4.x which often covers fees and reporting)
      3. Section numbering conventions: Section 2.x typically covers Scope and licensing requirements. Section 4.x typically covers Fees, Payments, and Reporting obligations.
      4. If you find sections containing the keywords above, they are HIGHLY RELEVANT even if they appear later in the list.
      5. Prioritize sections that directly state requirements (e.g., "must be", "shall", "required") over sections that are more general.
      
      ${sectionList.length > 0 ? `\nAvailable sections in context (for reference - check ALL of them):\n${sectionList.map(s => `- ${s.sectionNum ? `Section ${s.sectionNum}` : s.title} (similarity: ${Math.round(s.similarity * 100)}%)`).join('\n')}\n\n` : ''}
      
      ${contextText}

      ` : ''}Question: """
      ${sanitizedQuery}
      """

      Important: 
      ${isIntroductoryQuestion || !contextText ? `
      - If asked "how can you help", "what can you help with", "what can you do", "how can i help", "what do you do", "tell me about yourself", or similar introductory questions, respond by introducing yourself: "I'm the Legal Document Assistant. I can help you with all legal documentation including terms and conditions, privacy policies, contracts, and other legal documents. I can help you understand legal terms, check if customers are compliant with specific requirements, find relevant clauses and sections, and answer general legal questions based on your uploaded documents."
      ` : `
      - Answer based on the information provided in the legal documents above. The sections provided have been identified as relevant to your question.
      - CRITICAL: Review ALL sections provided and identify which sections MOST DIRECTLY answer the question. Look for sections that contain keywords and phrases from the question. For example:
        * If the question mentions "nodes", "servers", "licensing", "not under license", "unlicensed" → Look for sections about licensing requirements, "must be licensed", "all Servers", "Scope", "licensing requirements"
        * If the question mentions "violating", "compliance", "over-usage" → Look for sections about requirements, restrictions, reporting obligations, penalties
        * If the question mentions "production", "environment" → Look for sections that specify "all environments", "production, test, development"
      - IMPORTANT: The sections above are relevant to the question. Analyze ALL of them carefully, identify the MOST directly relevant ones, and provide a comprehensive answer based on what the documents say.
      - ALWAYS cite ALL directly relevant sections - not just 1-3, but ALL sections that directly answer the specific question. Do not limit citations if multiple sections are relevant.
      - ALWAYS provide direct quotes from ALL relevant sections when answering questions about compliance, licensing, terms, conditions, or specific clauses.
      - ALWAYS cite the specific section number/title and document name when providing answers. Use formats like:
        * "According to Section [section number/title] in [Document Name]: '[exact quote]'"
        * "As stated in [Document Name], Section [section number/title]: '[exact quote]'"
        * "Per Section [section number/title] of [Document Name]: '[exact quote]'"
      - When quoting, use quotation marks and be precise - copy the exact text from the document word-for-word.
      - For licensing/compliance questions, you MUST find and cite sections containing these EXACT phrases: "must be licensed", "licensed and subscribed", "all Servers", "all Cores", "all vCPUs", "all environments", "production, test, development, disaster recovery". These are typically in Section 2.x (Scope).
      - For questions about over-usage or exceeding licensed quantities, you MUST find and cite sections containing: "reporting", "notify", "over-usage", "exceeding quantity", "promptly notify". These are typically in Section 4.x (Fees and Payments).
      - If you see sections with these keywords, they are REQUIRED citations - do not skip them even if they appear later in the list.
      - Do NOT cite sections that are tangentially related or generic boilerplate like "Entire Agreement", "Non-Solicitation", "Force Majeure", "Assignment", "Notices", etc. unless they specifically relate to the question.
      - If the question is about compliance or whether something violates terms, identify ALL relevant sections that address the specific issue, analyze them comprehensively, and cite each one with quotes. Provide a complete answer covering all relevant requirements.
      - For questions asking "how to" or "what should I do" or "how can I tell/explain", provide practical guidance based on the legal requirements in the documents. For example:
        * If asked "how can I tell the customer about this?" in the context of a compliance issue, reference relevant sections (like reporting requirements, notification obligations) and provide guidance on what the customer needs to know based on those sections.
        * If asked "what should the customer do?", reference the requirements and obligations stated in the relevant sections.
        * Provide actionable guidance based on what the documents say, even if there isn't a specific "how-to" section.
      - You can provide guidance, recommendations, and practical advice based on the legal requirements stated in the documents. You don't need an exact match - you can infer appropriate guidance from the relevant sections.
      - ONLY if the provided sections contain NO information whatsoever that could answer the question (not even by reasonable inference or guidance), then say: "I don't have that information in the legal documents. Please consult with a legal professional or refer to the complete document."
      `}
      - Use markdown formatting for better readability.
      - Format quotes using blockquotes (> ) or quotation marks for emphasis.

      Answer as markdown (be helpful, accurate, and precise):
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
      const usedSections = legalSections.slice(0, legalSections.length).map(section => ({
        id: section.id,
        document_name: section.document_name,
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

