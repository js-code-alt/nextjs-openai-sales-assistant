import type { NextApiRequest, NextApiResponse } from 'next'
import { Configuration, OpenAIApi } from 'openai'
import { getDbPool } from '@/lib/db'
import { ApplicationError } from '@/lib/errors'

const openAiKey = process.env.OPENAI_KEY

const openAiConfig = new Configuration({
  apiKey: openAiKey,
})
const openai = new OpenAIApi(openAiConfig)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!openAiKey) {
      throw new ApplicationError('Missing environment variable OPENAI_KEY')
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const pool = getDbPool()
    const type = req.query.type as string || 'product' // Default to 'product' for backwards compatibility

    // Handle legal documents
    if (type === 'legal') {
      // Get document names, section titles, AND sample content to verify questions are answerable
      const [legalRows] = await pool.execute(
        `SELECT DISTINCT 
          ld.name as document_name,
          ls.section_title,
          LEFT(ls.content, 200) as content_sample
        FROM legal_documents ld
        JOIN legal_sections ls ON ld.id = ls.legal_id
        ORDER BY ld.created_at DESC, ls.id
        LIMIT 100`
      )

      const legalDocs = legalRows as Array<{
        document_name: string
        section_title: string | null
        content_sample: string | null
      }>

      if (legalDocs.length === 0) {
        // If no legal documents, return empty array to indicate no suggestions available
        return res.status(200).json({
          questions: [],
          hasDocuments: false,
        })
      }

      // Extract unique document names and section titles
      const documentNames = Array.from(new Set(legalDocs.map((d) => d.document_name)))
      const sectionTitles = Array.from(
        new Set(legalDocs.map((d) => d.section_title).filter((title): title is string => title !== null))
      ).slice(0, 20)

      // Group content samples by document to understand what topics are actually covered
      const documentContentMap = new Map<string, string[]>()
      legalDocs.forEach((doc) => {
        if (!documentContentMap.has(doc.document_name)) {
          documentContentMap.set(doc.document_name, [])
        }
        if (doc.content_sample) {
          documentContentMap.get(doc.document_name)!.push(doc.content_sample)
        }
      })

      // Create a summary of available data with content samples
      const contentSamples = Array.from(documentContentMap.entries())
        .slice(0, 10)
        .map(([name, samples]) => {
          const combinedSample = samples.slice(0, 3).join(' ').substring(0, 300)
          return `- ${name}: ${combinedSample}...`
        })
        .join('\n')

      const dataSummary = `
Legal documents available:
${documentNames.map((name) => `- ${name}`).join('\n')}

Sample topics/sections:
${sectionTitles.slice(0, 15).map((title) => `- ${title}`).join('\n')}

Sample content from documents (to verify questions are answerable):
${contentSamples}
`

      // Use OpenAI to generate relevant, specific questions based on the legal data
      const prompt = `You are helping generate suggested questions for a Legal Document Assistant chatbot. 
The assistant helps users find information from legal documents.

Based on the following legal documents that have been uploaded, generate 4-6 specific, actionable questions that a user might ask about legal documents. 
The questions should:
1. Be specific to the legal documents and topics that are ACTUALLY AVAILABLE (only use document names and section titles that are listed)
2. Be answerable based on the ACTUAL CONTENT SAMPLES provided - only suggest questions if the content samples show that information exists
3. Help users understand legal terms, clauses, or requirements that are clearly covered in the documents
4. Reference specific documents by name when relevant (use the exact document names from the list)
5. Be concise (one sentence each)
6. Focus on questions that can be answered with general information that is clearly present in the content samples
7. AVOID questions about specific updates, changes, or reasons unless the content samples explicitly mention those details
8. Prefer general questions like "What is [topic]?" or "What are the key terms in [document]?" over specific questions like "Why was [X] updated?" unless the content clearly explains the reason

Legal document data available:
${dataSummary}

CRITICAL: Only generate questions that you can verify are answerable based on the content samples provided. If a document name suggests a topic but the content samples don't show relevant information, do NOT generate questions about that topic. Focus on questions that are clearly answerable from the content shown.

Generate 4-6 questions as a JSON array of strings. Return ONLY the JSON array, no other text.
Example format: ["Question 1?", "Question 2?", "Question 3?"]`

      const response = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that generates relevant questions for a legal document chatbot. Always return valid JSON arrays.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      })

      if (response.status !== 200) {
        const error = response.data || response
        throw new ApplicationError('Failed to generate suggested questions', error)
      }

      const data = response.data
      const content = data.choices[0]?.message?.content?.trim()

      if (!content) {
        throw new ApplicationError('No content generated')
      }

      // Parse the JSON array from the response
      let questions: string[]
      try {
        const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        questions = JSON.parse(cleanedContent)
        
        if (!Array.isArray(questions) || !questions.every((q) => typeof q === 'string')) {
          throw new Error('Invalid format')
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON, using fallback:', parseError)
        questions = generateFallbackLegalQuestions(documentNames, sectionTitles)
      }

      // Ensure we have at least 3 questions, max 6
      if (questions.length < 3) {
        questions = [...questions, ...generateFallbackLegalQuestions(documentNames, sectionTitles)].slice(0, 6)
      }
      questions = questions.slice(0, 6)

      return res.status(200).json({
        questions,
        hasDocuments: true,
      })
    }

    // Handle GTM documents
    if (type === 'gtm') {
      // Get document names, section titles, AND sample content to verify questions are answerable
      const [gtmRows] = await pool.execute(
        `SELECT DISTINCT 
          gd.name as document_name,
          gs.section_title,
          LEFT(gs.content, 200) as content_sample
        FROM gtm_documents gd
        JOIN gtm_sections gs ON gd.id = gs.gtm_id
        ORDER BY gd.created_at DESC, gs.id
        LIMIT 100`
      )

      const gtmDocs = gtmRows as Array<{
        document_name: string
        section_title: string | null
        content_sample: string | null
      }>

      if (gtmDocs.length === 0) {
        // If no GTM documents, return empty array to indicate no suggestions available
        return res.status(200).json({
          questions: [],
          hasDocuments: false,
        })
      }

      // Extract unique document names and section titles
      const documentNames = Array.from(new Set(gtmDocs.map((d) => d.document_name)))
      const sectionTitles = Array.from(
        new Set(gtmDocs.map((d) => d.section_title).filter((title): title is string => title !== null))
      ).slice(0, 20)

      // Group content samples by document to understand what topics are actually covered
      const documentContentMap = new Map<string, string[]>()
      gtmDocs.forEach((doc) => {
        if (!documentContentMap.has(doc.document_name)) {
          documentContentMap.set(doc.document_name, [])
        }
        if (doc.content_sample) {
          documentContentMap.get(doc.document_name)!.push(doc.content_sample)
        }
      })

      // Create a summary of available data with content samples
      const contentSamples = Array.from(documentContentMap.entries())
        .slice(0, 10)
        .map(([name, samples]) => {
          const combinedSample = samples.slice(0, 3).join(' ').substring(0, 300)
          return `- ${name}: ${combinedSample}...`
        })
        .join('\n')

      const dataSummary = `
GTM documents available:
${documentNames.map((name) => `- ${name}`).join('\n')}

Sample topics/sections:
${sectionTitles.slice(0, 15).map((title) => `- ${title}`).join('\n')}

Sample content from documents (to verify questions are answerable):
${contentSamples}
`

      // Use OpenAI to generate relevant, specific questions based on the GTM data
      const prompt = `You are helping generate suggested questions for a Go-to-Market (GTM) Assistant chatbot. 
The assistant helps sales professionals position MariaDB against competitors and develop go-to-market strategies.

Based on the following GTM documents that have been uploaded, generate 4-6 specific, actionable questions that a sales professional might ask about competitive positioning and go-to-market strategies. 
The questions should:
1. Be specific to the GTM documents and competitive topics that are ACTUALLY AVAILABLE (only use document names and section titles that are listed)
2. Be answerable based on the ACTUAL CONTENT SAMPLES provided - only suggest questions if the content samples show that information exists
3. Help sales professionals understand how to position MariaDB against competitors mentioned in the documents
4. Focus on competitive differentiation, positioning strategies, and go-to-market approaches
5. Reference specific competitors or documents by name when relevant (use the exact document names from the list)
6. Be concise (one sentence each)
7. Focus on practical, actionable questions about competitive positioning and sales strategies

GTM document data available:
${dataSummary}

CRITICAL: Only generate questions that you can verify are answerable based on the content samples provided. Focus on questions about competitive positioning, differentiation, and go-to-market strategies that are clearly covered in the content.

Generate 4-6 questions as a JSON array of strings. Return ONLY the JSON array, no other text.
Example format: ["Question 1?", "Question 2?", "Question 3?"]`

      const response = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that generates relevant questions for a GTM/competitive positioning chatbot. Always return valid JSON arrays.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      })

      if (response.status !== 200) {
        const error = response.data || response
        throw new ApplicationError('Failed to generate suggested questions', error)
      }

      const data = response.data
      const content = data.choices[0]?.message?.content?.trim()

      if (!content) {
        throw new ApplicationError('No content generated')
      }

      // Parse the JSON array from the response
      let questions: string[]
      try {
        const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        questions = JSON.parse(cleanedContent)
        
        if (!Array.isArray(questions) || !questions.every((q) => typeof q === 'string')) {
          throw new Error('Invalid format')
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON, using fallback:', parseError)
        questions = generateFallbackGtmQuestions(documentNames, sectionTitles)
      }

      // Ensure we have at least 3 questions, max 6
      if (questions.length < 3) {
        questions = [...questions, ...generateFallbackGtmQuestions(documentNames, sectionTitles)].slice(0, 6)
      }
      questions = questions.slice(0, 6)

      return res.status(200).json({
        questions,
        hasDocuments: true,
      })
    }

    // Handle products (default behavior)
    // Fetch product names and sample section titles to understand what data is available
    const [productRows] = await pool.execute(
      `SELECT DISTINCT 
        p.name as product_name,
        ps.section_title
      FROM products p
      JOIN product_sections ps ON p.id = ps.product_id
      ORDER BY p.created_at DESC
      LIMIT 50`
    )

    const products = productRows as Array<{
      product_name: string
      section_title: string | null
    }>

    if (products.length === 0) {
      // If no products, return empty array to indicate no suggestions available
      return res.status(200).json({
        questions: [],
        hasDocuments: false,
      })
    }

    // Extract unique product names and section titles
    const productNames = Array.from(new Set(products.map((p) => p.product_name)))
    const sectionTitles = Array.from(
      new Set(products.map((p) => p.section_title).filter((title): title is string => title !== null))
    ).slice(0, 20) // Limit to 20 section titles to avoid token limits

    // Create a summary of available data
    const dataSummary = `
Products available:
${productNames.map((name) => `- ${name}`).join('\n')}

Sample topics/sections:
${sectionTitles.slice(0, 15).map((title) => `- ${title}`).join('\n')}
`

    // Use OpenAI to generate relevant, specific questions based on the product data
    const prompt = `You are helping generate suggested questions for a MariaDB Sales Assistant chatbot. 
The assistant helps sales professionals sell MariaDB products to customers.

Based on the following product information that has been uploaded, generate 4-6 specific, actionable questions that a sales professional might ask. 
The questions should:
1. Be specific to the products and topics available
2. Help sales professionals understand how to position and sell these products
3. Be practical and useful for sales conversations
4. Reference specific products or topics when relevant
5. Be concise (one sentence each)

Product data available:
${dataSummary}

Generate 4-6 questions as a JSON array of strings. Return ONLY the JSON array, no other text.
Example format: ["Question 1?", "Question 2?", "Question 3?"]`

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that generates relevant questions for a sales chatbot. Always return valid JSON arrays.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    })

    if (response.status !== 200) {
      const error = response.data || response
      throw new ApplicationError('Failed to generate suggested questions', error)
    }

    const data = response.data
    const content = data.choices[0]?.message?.content?.trim()

    if (!content) {
      throw new ApplicationError('No content generated')
    }

    // Parse the JSON array from the response
    let questions: string[]
    try {
      // Remove any markdown code blocks if present
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      questions = JSON.parse(cleanedContent)
      
      // Validate it's an array of strings
      if (!Array.isArray(questions) || !questions.every((q) => typeof q === 'string')) {
        throw new Error('Invalid format')
      }
    } catch (parseError) {
      // Fallback: try to extract questions from text if JSON parsing fails
      console.warn('Failed to parse JSON, using fallback:', parseError)
      questions = generateFallbackQuestions(productNames, sectionTitles)
    }

    // Ensure we have at least 3 questions, max 6
    if (questions.length < 3) {
      questions = [...questions, ...generateFallbackQuestions(productNames, sectionTitles)].slice(0, 6)
    }
    questions = questions.slice(0, 6)

    return res.status(200).json({
      questions,
      hasDocuments: true,
    })
  } catch (err: unknown) {
    if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      console.error(err)
    }

    // Return fallback questions on error
    const pool = getDbPool()
    const type = req.query.type as string || 'product'
    
    try {
      if (type === 'legal') {
        const [legalRows] = await pool.execute('SELECT DISTINCT name FROM legal_documents LIMIT 10')
        const documents = legalRows as Array<{ name: string }>
        const documentNames = documents.map((d) => d.name)
        
        if (documentNames.length === 0) {
          return res.status(200).json({
            questions: [],
            hasDocuments: false,
          })
        }
        
        return res.status(200).json({
          questions: generateFallbackLegalQuestions(documentNames, []),
          hasDocuments: true,
        })
      } else if (type === 'gtm') {
        const [gtmRows] = await pool.execute('SELECT DISTINCT name FROM gtm_documents LIMIT 10')
        const documents = gtmRows as Array<{ name: string }>
        const documentNames = documents.map((d) => d.name)
        
        if (documentNames.length === 0) {
          return res.status(200).json({
            questions: [],
            hasDocuments: false,
          })
        }
        
        return res.status(200).json({
          questions: generateFallbackGtmQuestions(documentNames, []),
          hasDocuments: true,
        })
      } else {
        const [productRows] = await pool.execute('SELECT DISTINCT name FROM products LIMIT 10')
        const products = productRows as Array<{ name: string }>
        const productNames = products.map((p) => p.name)
        
        if (productNames.length === 0) {
          return res.status(200).json({
            questions: [],
            hasDocuments: false,
          })
        }
        
        return res.status(200).json({
          questions: generateFallbackQuestions(productNames, []),
          hasDocuments: true,
        })
      }
    } catch (fallbackError) {
      return res.status(200).json({
        questions: [],
        hasDocuments: false,
      })
    }
  }
}

function generateFallbackQuestions(productNames: string[], sectionTitles: string[]): string[] {
  const questions: string[] = []

  if (productNames.length > 0) {
    const firstProduct = productNames[0]
    questions.push(`How do I sell ${firstProduct}?`)
    questions.push(`What are the key features of ${firstProduct}?`)
    
    if (productNames.length > 1) {
      questions.push(`What's the difference between ${productNames[0]} and ${productNames[1]}?`)
    }
  }

  if (sectionTitles.length > 0) {
    const relevantTitle = sectionTitles.find((t) => 
      t.toLowerCase().includes('pricing') || 
      t.toLowerCase().includes('benefit') ||
      t.toLowerCase().includes('feature')
    )
    if (relevantTitle) {
      questions.push(`Tell me about ${relevantTitle}`)
    }
  }

  // Add generic questions if we don't have enough
  const genericQuestions = [
    'How can I position MariaDB products to CTOs?',
    'What are the main value propositions?',
    'How do I handle common customer objections?',
  ]

  questions.push(...genericQuestions.slice(0, 6 - questions.length))

  return questions.slice(0, 6)
}

function generateFallbackLegalQuestions(documentNames: string[], sectionTitles: string[]): string[] {
  const questions: string[] = []

  if (documentNames.length > 0) {
    const firstDoc = documentNames[0]
    questions.push(`What does ${firstDoc} say about...?`)
    questions.push(`What are the key terms in ${firstDoc}?`)
    
    if (documentNames.length > 1) {
      questions.push(`What's the difference between ${documentNames[0]} and ${documentNames[1]}?`)
    }
  }

  if (sectionTitles.length > 0) {
    const relevantTitle = sectionTitles.find((t) => 
      t.toLowerCase().includes('terms') || 
      t.toLowerCase().includes('conditions') ||
      t.toLowerCase().includes('policy')
    )
    if (relevantTitle) {
      questions.push(`Tell me about ${relevantTitle}`)
    }
  }

  // Add generic questions if we don't have enough
  const genericQuestions = [
    'What are the main clauses in this document?',
    'What are my rights and obligations?',
    'What are the key legal terms I should know?',
  ]

  questions.push(...genericQuestions.slice(0, 6 - questions.length))

  return questions.slice(0, 6)
}

function generateFallbackGtmQuestions(documentNames: string[], sectionTitles: string[]): string[] {
  const questions: string[] = []

  if (documentNames.length > 0) {
    const firstDoc = documentNames[0]
    questions.push(`How do I position MariaDB against the competitors mentioned in ${firstDoc}?`)
    questions.push(`What are the key differentiators in ${firstDoc}?`)
    
    if (documentNames.length > 1) {
      questions.push(`What's the competitive positioning strategy for ${documentNames[0]} vs ${documentNames[1]}?`)
    }
  }

  if (sectionTitles.length > 0) {
    const relevantTitle = sectionTitles.find((t) => 
      t.toLowerCase().includes('competitive') || 
      t.toLowerCase().includes('positioning') ||
      t.toLowerCase().includes('differentiator')
    )
    if (relevantTitle) {
      questions.push(`Tell me about ${relevantTitle}`)
    }
  }

  // Add generic questions if we don't have enough
  const genericQuestions = [
    'How do I position MariaDB against competitors?',
    'What are the main competitive differentiators?',
    'How can I create effective go-to-market strategies?',
  ]

  questions.push(...genericQuestions.slice(0, 6 - questions.length))

  return questions.slice(0, 6)
}

