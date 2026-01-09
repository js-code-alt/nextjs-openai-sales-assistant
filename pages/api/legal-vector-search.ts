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
    // Lower threshold and get more results for legal documents to ensure we capture all relevant sections
    const matchThreshold = 0.70  // Lower threshold to capture more potentially relevant sections
    const matchCount = 15  // Increase from 10 to 15 to get more sections for analysis
    const minContentLength = 50

    // Convert embedding array to MariaDB VECTOR format string
    const embeddingVectorString = arrayToVectorString(embedding)

    // Extract document name keywords from query to boost matching documents
    // This helps prioritize documents that match the query's intent (e.g., "BSL" query should prioritize BSL license document)
    const queryLower = sanitizedQuery.toLowerCase()
    const documentKeywords: string[] = []
    
    // Detect specific documents mentioned in query
    if (/(?:^|\s)(?:bsl|business\s+source\s+license|business\s+source)(?:\s|$)/i.test(queryLower)) {
      documentKeywords.push('bsl', 'business source', 'business source license')
    }
    if (/(?:^|\s)(?:subscription\s+agreement|subscription)(?:\s|$)/i.test(queryLower)) {
      documentKeywords.push('subscription agreement', 'subscription')
    }
    if (/(?:^|\s)(?:maxscale|max\s+scale)(?:\s|$)/i.test(queryLower)) {
      documentKeywords.push('maxscale')
    }
    if (/(?:^|\s)(?:privacy\s+policy|privacy)(?:\s|$)/i.test(queryLower)) {
      documentKeywords.push('privacy', 'privacy policy')
    }
    if (/(?:^|\s)(?:terms\s+of\s+service|terms\s+and\s+conditions|terms)(?:\s|$)/i.test(queryLower)) {
      documentKeywords.push('terms', 'terms of service')
    }
    
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

    let legalSections = legalSectionRows as Array<{
      id: number
      legal_id: number
      section_title: string | null
      content: string | null
      document_name: string
      similarity: number
    }>

    // Boost sections from documents whose names match query keywords
    // This ensures that queries about "BSL" prioritize BSL license document sections
    if (documentKeywords.length > 0) {
      legalSections = legalSections.map(section => {
        const docNameLower = section.document_name.toLowerCase()
        let boostedSimilarity = section.similarity
        
        // Check if document name contains any of the detected keywords
        for (const keyword of documentKeywords) {
          if (docNameLower.includes(keyword.toLowerCase())) {
            // Apply boost based on keyword specificity
            const boost = keyword.length > 10 ? 1.25 : keyword.length > 5 ? 1.20 : 1.15
            boostedSimilarity = Math.min(1.0, section.similarity * boost)
            break // Use the first match (most specific should be checked first)
          }
        }
        
        return {
          ...section,
          similarity: boostedSimilarity
        }
      })
      
      // Re-sort by boosted similarity (highest first)
      legalSections.sort((a, b) => b.similarity - a.similarity)
    }

    // Check if query is about licensing/compliance - if so, also do keyword search
    const isLicensingQuery = /(license|licensed|unlicensed|node|server|core|vCPU|violat|complian|over.?usage|exceed|community|enterprise|production|environment|use|using)/i.test(sanitizedQuery)
    
    // Check if query is about reporting/notification obligations
    const isReportingObligationQuery = /(obliged|obligation|must tell|must notify|must report|required to tell|required to notify|required to report|should tell|should notify|should report|tell.*about|notify.*about|report.*about|inform.*about|disclose|extra node|additional node|unlicensed node|node.*not.*license)/i.test(sanitizedQuery)
    
    // Check if query is asking how to inform/communicate with clients
    const isHowToInformQuery = /(how.*inform|how.*tell|how.*communicate|how.*email|how.*discuss|how.*advise|how.*explain|advise.*how|suggest.*email|email.*template|how.*write)/i.test(sanitizedQuery)
    
    // Check if query is asking to generate/write an email (more specific than just "how to")
    const isGenerateEmailQuery = /(generate.*email|write.*email|create.*email|draft.*email|email.*that|email.*explain|email.*communicate|email.*to.*customer|email.*to.*client)/i.test(sanitizedQuery)
    
    let keywordBoostedSections: Array<{
      id: number
      legal_id: number
      section_title: string | null
      content: string | null
      document_name: string
      similarity: number
    }> = []

    if (isLicensingQuery || isReportingObligationQuery || isHowToInformQuery) {
      // Also search for sections with licensing keywords that might have been missed
      const licensingKeywords = [
        'must be licensed', 
        'licensed and subscribed', 
        'all Servers', 
        'all Cores', 
        'all vCPUs', 
        'all environments', 
        'production, test, development', 
        'production',
        'Scope',
        'Scope of Services',
        'use with the Software',
        'must be licensed and subscribed'
      ]
      
      // Keywords specifically for reporting/notification obligations
      const reportingKeywords = [
        'promptly notify',
        'must notify',
        'must promptly notify',
        'reporting',
        'notify',
        'over-usage',
        'exceeding quantity',
        'usage exceeds',
        'exceeds the quantity',
        'exceeds the quantity of licensed',
        'exceeds the scope',
        'Section 4',
        'Section 4.4',
        'Fees and Payments',
        'usage reports',
        'must promptly notify MariaDB'
      ]
      
      // Combine keywords based on query type
      // For "how to inform" questions, prioritize both licensing and reporting keywords since they need to reference both
      const allKeywords = isHowToInformQuery
        ? [...reportingKeywords, ...licensingKeywords] // Include both for communication guidance
        : isReportingObligationQuery 
          ? [...reportingKeywords, ...licensingKeywords]
          : [...licensingKeywords, ...reportingKeywords]
      
      const keywordConditions = allKeywords.map(() => '(ls.content LIKE ? OR ls.section_title LIKE ?)').join(' OR ')
      const keywordParams = allKeywords.flatMap(kw => [`%${kw}%`, `%${kw}%`])
      
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
      // Include similarity score to indicate relevance (higher = more relevant)
      const similarityPercent = Math.round(legalSection.similarity * 100)
      contextText += `[DOCUMENT: ${documentName}] (Relevance: ${similarityPercent}%)\nSECTION: ${sectionTitle}\n\n${content.trim()}\n\n---\n\n`
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
      
      The sections below are ordered by relevance to your question (most relevant first, typically with highest similarity scores). These sections have been identified as relevant to your question and ARE AVAILABLE for you to use. 
      
      CRITICAL: These sections contain information that can answer the question. Sections with very high similarity scores (90%+, especially 100%) are HIGHLY RELEVANT and you MUST extract and use information from them to answer the question. Do not say "I don't have that information" if these sections are provided - they ARE the information.
      
      **ABSOLUTE REQUIREMENT**: If you see ANY section with 100% similarity/relevance score, that section contains DIRECTLY RELEVANT information that answers the question. You MUST read and extract information from ALL 100% match sections. Do NOT ignore them or say the information is not available.
      
      CRITICAL INSTRUCTIONS FOR FINDING RELEVANT SECTIONS:
      1. **RELEVANCE SCORES (CRITICAL)**: Each section below includes a relevance score (percentage). Sections with 90%+ relevance (especially 100%) are HIGHLY RELEVANT and you MUST extract information from them to answer the question. These sections were identified as directly relevant to your question.
      2. **100% MATCH SECTIONS ARE MANDATORY**: If ANY section has a 100% match score, it means the vector search found EXACT semantic matches. You MUST read these sections completely and extract ALL relevant information from them. These sections directly answer the question.
      3. Review ALL sections below - do not just look at the first few. Scan through ALL of them, but prioritize sections with higher relevance scores.
      3. **DOCUMENT NAME MATCHING (CRITICAL)**: If the question mentions a specific document type or name (e.g., "BSL", "Business Source License", "Subscription Agreement", "MaxScale", "Privacy Policy", "Terms of Service"), you MUST prioritize sections from documents whose names match that topic. For example:
         - Questions about "BSL" or "Business Source License" should prioritize sections from documents named "BSL License", "Business Source License", etc.
         - Questions about "Subscription Agreement" should prioritize sections from documents named "Subscription Agreement" or "MariaDB Subscription Agreement"
         - Questions about "MaxScale" should prioritize sections from documents about MaxScale
      4. Look for sections that contain these EXACT phrases or keywords:
         - "must be licensed" OR "licensed and subscribed" OR "all Servers" OR "all Cores" OR "all vCPUs"
         - "all environments" OR "production, test, development, disaster recovery"
         - "Scope" (especially Section 2.x which often covers licensing requirements)
         - "reporting" OR "notify" OR "over-usage" OR "exceeding quantity" (especially Section 4.x which often covers fees and reporting)
      5. Section numbering conventions: Section 2.x typically covers Scope and licensing requirements. Section 4.x typically covers Fees, Payments, and Reporting obligations.
      6. If you find sections containing the keywords above, they are HIGHLY RELEVANT even if they appear later in the list.
      7. Prioritize sections that directly state requirements (e.g., "must be", "shall", "required") over sections that are more general.
      8. **DO NOT cite sections from the wrong document**. For example, if the question is about "BSL license", do NOT cite sections from "Subscription Agreement" documents unless they directly mention BSL licensing.
      
      ${sectionList.length > 0 ? `\nAvailable sections in context (for reference - check ALL of them):\n${sectionList.map(s => `- ${s.sectionNum ? `Section ${s.sectionNum}` : s.title} (similarity: ${Math.round(s.similarity * 100)}%)`).join('\n')}\n\n` : ''}
      
      ${contextText}

      ` : ''}Question: """
      ${sanitizedQuery}
      """

      ${isGenerateEmailQuery ? `
      **CRITICAL: EMAIL GENERATION REQUEST DETECTED**
      
      The user is asking you to GENERATE/WRITE/CREATE/DRAFT an email. You MUST write a COMPLETE, READY-TO-USE email - NOT just explain what should be in it.
      
      ${conversationHistory.length > 0 ? `
      **CONVERSATION CONTEXT (CRITICAL - USE THIS INFORMATION IN THE EMAIL):**
      
      The following is the conversation history that provides context about the specific compliance issue. You MUST incorporate these specific details into the email:
      
      ${conversationHistory.map((msg: { query: string; response: string }, idx: number) => {
        const query = msg.query || ''
        // Include the full user query as it contains the key details
        return `Previous Question ${idx + 1}: ${query}`
      }).join('\n')}
      
      **IMPORTANT**: The email MUST reference the SPECIFIC compliance issue mentioned in the conversation above. Extract and include:
      - The specific type of node/component mentioned (e.g., "arbitrator node")
      - Whether it's "not under license", "unlicensed", or "not licensed"
      - The number of nodes in the subscription (e.g., "3 nodes", "active subscription of 3 nodes")
      - The environment (e.g., "in production")
      - The subscription type (e.g., "MariaDB Enterprise subscription")
      - Any other specific details about the client's situation
      
      For example, if the conversation mentions "I have a client with an existing MariaDB Enterprise subscription in production, I found out that they have an arbitrator node that is not under license", the email MUST state something like: "You have an active MariaDB Enterprise subscription for [X] nodes in production, but we have identified an additional arbitrator node that is not under license."
      
      ` : ''}
      
      Your response MUST be a complete email with:
      1. **Subject line** (format as: "Subject: [subject text]")
      2. **Greeting** (e.g., "Dear [Client Name]," or "Dear Customer,")
      3. **Body paragraphs** that:
         - Clearly state the SPECIFIC compliance issue from the conversation context (e.g., "You have an active subscription for 3 nodes, but we have identified an additional arbitrator node in production that is not under license")
         - Reference Section 2.1 with the exact quote about licensing requirements (all Servers/Cores/vCPUs must be licensed)
         - Reference Section 4.4 with the exact quote about reporting obligations (must promptly notify MariaDB if usage exceeds licensed quantities)
         - Explain what the client needs to do (license the node, report it, etc.)
         - Be professional, clear, and actionable
      4. **Closing** (e.g., "Best regards," or "Sincerely,")
      5. **Signature placeholder** (e.g., "[Your Name]" or leave blank)
      
      The email should be professional, ready to send (you may use placeholders like "[Client Name]" if needed), and MUST address the SPECIFIC compliance issue mentioned in the conversation context above.
      
      DO NOT write explanations about what should be in the email. WRITE THE ACTUAL EMAIL TEXT.
      
      ` : ''}
      Important: 
      ${isIntroductoryQuestion || !contextText ? `
      - If asked "how can you help", "what can you help with", "what can you do", "how can i help", "what do you do", "tell me about yourself", or similar introductory questions, respond by introducing yourself: "I'm the Legal Document Assistant. I can help you with all legal documentation including terms and conditions, privacy policies, contracts, and other legal documents. I can help you understand legal terms, check if customers are compliant with specific requirements, find relevant clauses and sections, and answer general legal questions based on your uploaded documents."
      ` : `
      - Answer based on the information provided in the legal documents above. The sections provided have been identified as relevant to your question.
      - CRITICAL - DOCUMENT MATCHING: If the question mentions a specific document type (e.g., "BSL", "Business Source License", "Subscription Agreement", "MaxScale", "Privacy Policy", "Terms of Service"), you MUST prioritize and cite sections from documents whose names match that document type. For example:
        * If asked about "BSL" or "Business Source License", cite sections from the BSL/Business Source License document, NOT from Subscription Agreement
        * If asked about "Subscription Agreement", cite sections from the Subscription Agreement document
        * If asked about "MaxScale", cite sections from MaxScale-related documents
      - CRITICAL: Review ALL sections provided and identify which sections MOST DIRECTLY answer the question. Look for sections that contain keywords and phrases from the question. For example:
        * If the question mentions "nodes", "servers", "licensing", "not under license", "unlicensed", "Community", "Enterprise", "use", "using", "production" → Look for sections about licensing requirements, "must be licensed", "all Servers", "Scope", "Scope of Services", "licensing requirements", "use with the Software"
        * **CRITICAL FOR REPORTING OBLIGATIONS**: If the question mentions "obliged", "obligation", "must tell", "must notify", "must report", "required to tell/notify/report", "should tell/notify/report", "extra node", "additional node", "unlicensed node", or asks whether they need to inform/report about nodes or exceeding licensed quantities → You MUST find and cite Section 4.4 (Reporting) as the PRIMARY answer. Section 4.4 states: "The Customer must promptly notify MariaDB if the Customer's usage exceeds the quantity of licensed Products or scope of purchased Services specified in the Order Form. The Customer must also provide MariaDB with usage reports upon request." This is the section that directly answers questions about reporting obligations.
        * **CRITICAL FOR "HOW TO INFORM" QUESTIONS**: If the question asks "how can I inform/tell/communicate/email" the client about a compliance issue (especially regarding unlicensed nodes, licensing violations, or exceeding licensed quantities), you MUST reference both Section 2.1 (for licensing requirements) and Section 4.4 (for reporting obligations). Structure your guidance to: (1) Explain the issue clearly, (2) Cite Section 2.1 with the quote about all Servers/Cores/vCPUs must be licensed, (3) Cite Section 4.4 with the quote about reporting obligations, (4) Provide practical email/talking point suggestions that reference these specific sections.
        * If the question mentions "violating", "compliance", "over-usage" → Look for sections about requirements, restrictions, reporting obligations, penalties, and specifically Section 4.4 for reporting requirements
        * If the question mentions "production", "environment", "enterprise environment" → Look for sections that specify "all environments", "production, test, development", "Scope of Services"
        * Questions about "can a client use" or "is it allowed" → Look for sections about Scope, licensing requirements, restrictions, what is permitted
      - IMPORTANT: The sections above are relevant to the question. Analyze ALL of them carefully, identify the MOST directly relevant ones, and provide a comprehensive answer based on what the documents say.
      - **STRUCTURE YOUR ANSWER CLEARLY**: Provide a single, well-structured answer without repeating the same information. State your conclusion first, then cite the relevant section(s) with quotes, and provide a brief summary. Do NOT repeat the same point multiple times in different paragraphs.
      - ALWAYS cite ALL directly relevant sections - not just 1-3, but ALL sections that directly answer the specific question. Do not limit citations if multiple sections are relevant.
      - ALWAYS provide direct quotes from ALL relevant sections when answering questions about compliance, licensing, terms, conditions, or specific clauses. However, cite each section only once - do not repeat the same quote or citation multiple times.
      - ALWAYS cite the specific section number/title and document name when providing answers. Use formats like:
        * "According to Section [section number/title] in [Document Name]: '[exact quote]'"
        * "As stated in [Document Name], Section [section number/title]: '[exact quote]'"
        * "Per Section [section number/title] of [Document Name]: '[exact quote]'"
      - When quoting, use quotation marks and be precise - copy the exact text from the document word-for-word.
      - For licensing/compliance questions, you MUST find and cite sections containing these EXACT phrases: "must be licensed", "licensed and subscribed", "all Servers", "all Cores", "all vCPUs", "all environments", "production, test, development, disaster recovery". These are typically in Section 2.x (Scope).
      - For questions about over-usage or exceeding licensed quantities, you MUST find and cite sections containing: "reporting", "notify", "over-usage", "exceeding quantity", "promptly notify". These are typically in Section 4.x (Fees and Payments).
      - **MANDATORY FOR REPORTING OBLIGATION QUESTIONS**: For questions about reporting obligations, notification requirements, or whether customers must tell/notify about extra nodes, additional nodes, unlicensed nodes, or exceeding licensed quantities (e.g., "are they obliged to tell", "must they notify", "required to report", "are they obliged to tell me there is an extra node"), you MUST find and cite Section 4.4 (Reporting) as the PRIMARY answer. Section 4.4 states: "The Customer must promptly notify MariaDB if the Customer's usage exceeds the quantity of licensed Products or scope of purchased Services specified in the Order Form. The Customer must also provide MariaDB with usage reports upon request." This section directly answers whether customers are obliged to report extra nodes or exceeding licensed quantities. You may also cite Section 2.1 for context about licensing requirements, but Section 4.4 is the section that answers the reporting obligation question.
      - If you see sections with these keywords, they are REQUIRED citations - do not skip them even if they appear later in the list.
      - Do NOT cite sections that are tangentially related or generic boilerplate like "Entire Agreement", "Non-Solicitation", "Force Majeure", "Assignment", "Notices", etc. unless they specifically relate to the question.
      - If the question is about compliance or whether something violates terms, identify ALL relevant sections that address the specific issue, analyze them comprehensively, and cite each one with quotes. Provide a complete answer covering all relevant requirements.
      - **CRITICAL FOR EMAIL GENERATION REQUESTS**: If the question asks to "generate an email", "write an email", "create an email", "draft an email", or "email that explains", you MUST write a COMPLETE, READY-TO-USE email. Do NOT just explain what should be in the email - actually write the full email text. The email must include:
        * A clear subject line (format as "Subject: [subject text]")
        * A professional greeting (e.g., "Dear [Client Name]," or "Dear Customer,")
        * A clear body that explains the legal issue, cites relevant sections (especially Section 2.1 and Section 4.4 for licensing issues), and provides actionable guidance
        * A professional closing (e.g., "Best regards," or "Sincerely,")
        * The email should be professional, clear, and ready to send (you may use placeholders like "[Client Name]" if needed)
        * Reference the specific compliance issue from the conversation context (e.g., if it was about an unlicensed arbitrator node, mention that specifically)
        * Include direct quotes from relevant sections (Section 2.1 for licensing requirements, Section 4.4 for reporting obligations)
        * Make the email practical and actionable - tell the client what they need to do
      - For questions asking "how to" or "what should I do" or "how can I tell/explain" or "how can I inform/communicate" or "how can I advise", provide practical, actionable guidance based on the legal requirements in the documents. **CRITICAL FOR "HOW TO INFORM" QUESTIONS**: When providing guidance on how to communicate with clients about compliance issues (especially licensing violations, unlicensed nodes, or exceeding licensed quantities):
        * **MANDATORY: ALWAYS reference Section 2.1 and Section 4.4** when the issue involves licensing compliance. These are the key sections: Section 2.1 (licensing requirements) and Section 4.4 (reporting obligations). You MUST cite both sections with their exact quotes in your guidance.
        * **Address the specific issue** mentioned in the conversation context (e.g., if the conversation was about an unlicensed arbitrator node, structure your guidance around that specific issue - mention the arbitrator node, reference Section 2.1 about all nodes needing to be licensed, and Section 4.4 about reporting obligations).
        * **Provide a clear structure** for client communications: (1) State the issue clearly (e.g., "unlicensed arbitrator node"), (2) Reference Section 2.1 with the quote about all Servers/Cores/vCPUs must be licensed, (3) Reference Section 4.4 with the quote about reporting obligations, (4) Explain what needs to be done (license the node and report it), (5) Provide practical email template or talking points.
        * **Be practical and helpful** - provide email templates, talking points, or structured guidance that helps the user communicate effectively with their client. The email/talking points should reference the specific sections (2.1 and 4.4) and address the specific compliance issue.
        * **DO NOT provide generic advice** - tailor your guidance to the specific compliance issue (e.g., unlicensed arbitrator node) and always reference the relevant sections (Section 2.1 and Section 4.4).
        * If asked "how can I tell the customer about this?" or "how can I inform the client" or "how can I advise", structure your response to help them communicate the specific compliance issue, citing Section 2.1 (licensing requirements) and Section 4.4 (reporting obligations) with their exact quotes.
        * If asked "what should the customer do?", reference the requirements and obligations stated in the relevant sections (Section 2.1 and Section 4.4).
        * Provide actionable guidance based on what the documents say, even if there isn't a specific "how-to" section.
      - You can provide guidance, recommendations, and practical advice based on the legal requirements stated in the documents. You don't need an exact match - you can infer appropriate guidance from the relevant sections.
      - **MANDATORY FOR 100% MATCH SECTIONS**: If ANY section has a 100% similarity score, you MUST extract and use information from it. A 100% match means the vector search found a perfect semantic match - the section directly answers the question. Read the entire section content and extract all relevant information.
      - IMPORTANT: If sections are provided with high similarity scores (especially 90%+ or 100%), they ARE relevant and you MUST use them to answer the question. Do not ignore sections just because they don't contain the exact words from the question - extract and use the relevant information they contain.
      - When sections are provided with high similarity scores, extract the relevant information and answer the question based on that information. Even if the wording isn't identical, the information is relevant.
      - **BEFORE saying "I don't have that information"**: You MUST check ALL sections, especially those with 90%+ or 100% similarity scores. Read the full content of high-relevance sections, not just the titles. Extract information even if it requires interpretation or inference from the content.
      - ONLY if ALL provided sections contain absolutely NO information that could even tangentially relate to the question after carefully reading ALL sections (especially 100% match sections), then say: "I don't have that information in the legal documents. Please consult with a legal professional or refer to the complete document."
      `}
      - Use markdown formatting for better readability.
      - Format quotes using blockquotes (> ) or quotation marks for emphasis.
      - **AVOID REPETITION**: Do not repeat the same information, conclusion, or quote multiple times. Structure your answer as: (1) Direct answer to the question, (2) Citation of relevant section(s) with quote(s), (3) Brief summary if needed. Keep it concise and avoid redundant paragraphs.

      Answer as markdown (be helpful, accurate, and precise):
    `

    const chatMessage: ChatCompletionRequestMessage = {
      role: 'user',
      content: prompt,
    }

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [chatMessage],
      max_tokens: isGenerateEmailQuery ? 1500 : 512, // More tokens for email generation
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

