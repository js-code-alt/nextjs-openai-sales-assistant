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
      // If no products, return generic questions
      return res.status(200).json({
        questions: [
          'How can you help me with sales?',
          'What products are available?',
          'How do I get started?',
        ],
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
    })
  } catch (err: unknown) {
    if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      console.error(err)
    }

    // Return fallback questions on error
    const pool = getDbPool()
    try {
      const [productRows] = await pool.execute('SELECT DISTINCT name FROM products LIMIT 10')
      const products = productRows as Array<{ name: string }>
      const productNames = products.map((p) => p.name)
      
      return res.status(200).json({
        questions: generateFallbackQuestions(productNames, []),
      })
    } catch (fallbackError) {
      return res.status(200).json({
        questions: [
          'How can you help me with sales?',
          'What products are available?',
          'How do I position MariaDB products?',
        ],
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

