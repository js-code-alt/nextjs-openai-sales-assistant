# How Vector Search and OpenAI API Interact

This document explains the flow of how vector search (via MariaDB) and OpenAI API work together in this application.

## Two-Phase Architecture

### Phase 1: Indexing (Setup) - `lib/generate-embeddings.ts`

This phase happens when you run `pnpm run embeddings` to prepare your product documentation for search.

```
1. Read Product Documentation
   ↓
2. Process MDX/Markdown files
   - Extract sections (split by headings)
   - Parse metadata
   ↓
3. For each section:
   a. Send content to OpenAI Embedding API
      - Model: text-embedding-ada-002
      - Input: Section text (newlines replaced with spaces)
      - Output: 1536-dimensional vector (array of numbers)
   ↓
   b. Store in MariaDB
      - Table: product_sections
      - Column: embedding VECTOR(1536)
      - Index: Vector index for fast similarity search
```

**Key Code** (`generate-embeddings.ts:414-426`):
```typescript
const embeddingResponse = await openai.createEmbedding({
  model: 'text-embedding-ada-002',
  input: content.replace(/\n/g, ' '), // Replace newlines
})

const [responseData] = embeddingResponse.data.data
const embeddingVectorString = arrayToVectorString(responseData.embedding)

await pool.execute(
  'INSERT INTO product_sections (..., embedding) VALUES (..., Vec_FromText(?))',
  [embeddingVectorString]
)
```

---

### Phase 2: Query (Runtime) - `pages/api/vector-search.ts`

This phase happens every time a user asks a question.

```
User Question
   ↓
1. Content Moderation (OpenAI)
   - Check if query violates OpenAI policies
   ↓
2. Generate Query Embedding (OpenAI)
   - Model: text-embedding-ada-002
   - Convert user question → 1536-dim vector
   ↓
3. Vector Similarity Search (MariaDB)
   - Use VEC_DISTANCE() function (cosine distance)
   - Find top 10 most similar product sections
   - Similarity threshold: > 0.78
   ↓
4. Build Context
   - Combine matched sections into context text
   - Limit to ~1500 tokens
   ↓
5. Generate Response (OpenAI)
   - Model: gpt-3.5-turbo
   - Input: System prompt + Product context + User question
   - Output: Streamed markdown response
```

**Step-by-Step Code Flow**:

#### Step 1 & 2: Moderation + Embedding Generation
```typescript
// vector-search.ts:63-88
const moderationResponse = await openai.createModeration({ input: sanitizedQuery })
// ... check if flagged ...

const embeddingResponse = await openai.createEmbedding({
  model: 'text-embedding-ada-002',
  input: sanitizedQuery.replaceAll('\n', ' '),
})

const { data: [{ embedding }] } = await embeddingResponse.json()
```

#### Step 3: Vector Search in MariaDB
```typescript
// vector-search.ts:102-117
const embeddingVectorString = arrayToVectorString(embedding) // Convert [0.1, 0.2, ...] → "[0.1,0.2,...]"

const [productSectionRows] = await pool.execute(
  `SELECT 
    ps.id, ps.section_title, ps.content, p.name as product_name,
    (1 - VEC_DISTANCE(ps.embedding, Vec_FromText(?))) AS similarity
   FROM product_sections ps
   JOIN products p ON ps.product_id = p.id
   WHERE CHAR_LENGTH(ps.content) >= ?
     AND (1 - VEC_DISTANCE(ps.embedding, Vec_FromText(?))) > ?
   ORDER BY VEC_DISTANCE(ps.embedding, Vec_FromText(?)) ASC
   LIMIT ?`,
  [embeddingVectorString, minContentLength, embeddingVectorString, matchThreshold, embeddingVectorString, matchCount]
)
```

**How Vector Distance Works**:
- `VEC_DISTANCE()` calculates cosine distance (0 = identical, 1 = completely different)
- `(1 - VEC_DISTANCE())` converts to similarity (1 = identical, 0 = completely different)
- We order by distance ASC (lowest distance = most similar)
- Filter by similarity > 0.78 (only keep relevant matches)

#### Step 4: Build Context
```typescript
// vector-search.ts:128-146
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
let tokenCount = 0
let contextText = ''

for (let i = 0; i < productSections.length; i++) {
  const productSection = productSections[i]
  const encoded = tokenizer.encode(productSection.content)
  tokenCount += encoded.text.length
  
  if (tokenCount >= 1500) break // Limit context size
  
  contextText += `Product: ${productSection.product_name}\nSection: ${productSection.section_title}\n${productSection.content.trim()}\n---\n`
}
```

#### Step 5: Generate Response
```typescript
// vector-search.ts:148-186
const prompt = `
  You are a MariaDB Sales Assistant...
  
  Product Information:
  ${contextText}
  
  Question: """
  ${sanitizedQuery}
  """
  
  Answer as markdown...
`

const response = await openai.createChatCompletion({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 512,
  temperature: 0,
  stream: true, // Stream response to client
})
```

---

## Why This Architecture?

### Benefits:

1. **Efficient Search**: Vector similarity search is much faster than full-text search for semantic queries
2. **Context-Aware**: Only relevant product sections are included in the prompt (saves tokens & improves accuracy)
3. **Up-to-Date**: Can add/update product docs without retraining the LLM
4. **Cost-Effective**: Embeddings are cheap; only use expensive chat API with limited context
5. **Accurate**: LLM only uses verified product information, reducing hallucinations

### The Two OpenAI API Calls:

1. **Embedding API** (`text-embedding-ada-002`):
   - Purpose: Convert text → vector representation
   - Cost: Very cheap (~$0.0001 per 1K tokens)
   - Used: Once per doc section (indexing) + once per query (runtime)

2. **Chat Completion API** (`gpt-3.5-turbo`):
   - Purpose: Generate natural language response
   - Cost: More expensive (~$0.002 per 1K tokens)
   - Used: Once per user query, but only with limited context

---

## Example Flow

**User asks**: "tell me about a mariadb product"

1. **Query embedding**: `[0.123, -0.456, 0.789, ...]` (1536 numbers)
2. **Vector search finds**:
   - MariaDB MaxScale section (similarity: 0.92)
   - MariaDB Enterprise Server section (similarity: 0.85)
   - MariaDB SkySQL section (similarity: 0.81)
3. **Context built**: Includes top 3 sections (~1200 tokens)
4. **GPT generates**: Natural response about MariaDB MaxScale, formatted as markdown

The response is grounded in actual product documentation, not general knowledge!

