# 🏗️ Two-Phase AI Architecture

This document provides a comprehensive overview of the two-phase AI architecture powering the Sales Assistant application.

> 📚 **[← Back to README](./README.md)** | 🚀 **Quick Start**: See [README.md](./README.md#-getting-started) for setup instructions

### 🎯 Architecture at a Glance

| Aspect | Details |
|--------|---------|
| **Architecture Pattern** | Two-Phase AI (Indexing + Query) |
| **Indexing Strategy** | One-time document processing with incremental updates (checksum-based) |
| **Vector Dimensions** | 1536 (OpenAI text-embedding-ada-002) |
| **Similarity Metric** | Cosine Distance (optimized for normalized vectors) |
| **Similarity Threshold** | 0.78 (tuned for precision/recall balance) |
| **Context Window** | ~1500 tokens (top 5-10 sections) |
| **LLM Model** | gpt-3.5-turbo (streaming enabled) |
| **Database** | MariaDB Cloud 11.7+ with native VECTOR support |
| **Vector Index Type** | Approximate Nearest Neighbor (ANN) with cosine distance |

## 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Detailed Data Flow](#-detailed-data-flow)
  - [Phase 1: Indexing Pipeline](#phase-1-indexing-pipeline)
  - [Phase 2: Query Pipeline](#phase-2-query-pipeline)
- [Component Architecture](#-component-architecture)
- [Database Schema](#-database-schema)
- [Vector Search Query Breakdown](#-vector-search-query-breakdown)
- [Performance Characteristics](#-performance-characteristics)
- [Cost Breakdown](#-cost-breakdown)
- [Security & Validation Flow](#-security--validation-flow)
- [Key Design Decisions](#-key-design-decisions)
- [Related Documentation](#-related-documentation)

## 📊 Architecture Overview

```mermaid
graph TB
    subgraph "PHASE 1: Indexing (Build Time) 📚"
        A[📄 Knowledge Base Documents<br/>MDX/Markdown Files] --> B[🔪 Chunk into Sections<br/>By Headings]
        B --> C[🧠 OpenAI Embedding API<br/>text-embedding-ada-002]
        C --> D[📊 1536-dim Vector Array<br/>[0.123, -0.456, 0.789, ...]]
        D --> E[💾 MariaDB Cloud<br/>VECTOR(1536) Type]
        E --> F[⚡ Vector Index<br/>DISTANCE=cosine, M=16]
        F --> G[(🗄️ Indexed Knowledge Base<br/>Fast Similarity Search)]
    end
    
    subgraph "PHASE 2: Query (Runtime) ⚡"
        H[👤 User Question] --> I[🛡️ Content Moderation<br/>Parallel Check]
        H --> J[🧠 OpenAI Embedding API<br/>text-embedding-ada-002]
        I --> K{✅ Approved?}
        K -->|❌ No| L[🚫 Reject Request]
        K -->|✅ Yes| J
        J --> M[📊 Query Vector<br/>1536-dim]
        M --> N[🔍 MariaDB Vector Search<br/>VEC_DISTANCE Function]
        N --> G
        G --> O[📋 Top 10 Relevant Sections<br/>Similarity > 0.78]
        O --> P[📝 Build Context Prompt<br/>~1500 tokens max]
        P --> Q[🤖 OpenAI Chat API<br/>gpt-3.5-turbo]
        Q --> R[📡 Streamed Response<br/>SSE to Frontend]
    end
    
    style A fill:#e1f5ff
    style G fill:#d4edda
    style Q fill:#fff3cd
    style R fill:#f8d7da
```

## 🔄 Detailed Data Flow

### Phase 1: Indexing Pipeline

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Script as generate-embeddings.ts
    participant Files as MDX/Markdown Files
    participant OpenAI as OpenAI Embedding API
    participant DB as MariaDB Cloud
    
    Dev->>Script: Run `pnpm run embeddings`
    Script->>Files: Scan and read documents
    Files-->>Script: Document content
    
    loop For each document
        Script->>Script: Calculate SHA-256 checksum
        Script->>DB: Check if checksum exists
        alt Checksum exists
            DB-->>Script: Document unchanged
            Script->>Script: Skip (incremental update)
        else Checksum missing/new
            Script->>Script: Split by headings into sections
            Script->>Script: Remove JSX/MDX elements
            loop For each section
                Script->>OpenAI: POST /embeddings<br/>text-embedding-ada-002
                OpenAI-->>Script: 1536-dim embedding array
                Script->>Script: Convert to MariaDB format
                Script->>DB: INSERT INTO product_sections<br/>WITH Vec_FromText()
                DB-->>Script: Section stored
            end
            Script->>DB: UPDATE checksum
        end
    end
    
    Script->>DB: CREATE VECTOR INDEX (if needed)
    DB-->>Script: Index ready
    Script-->>Dev: ✅ Embeddings complete
```

### Phase 2: Query Pipeline

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Frontend as Next.js Frontend
    participant API as vector-search.ts API
    participant OpenAI as OpenAI API
    participant DB as MariaDB Cloud
    
    User->>Frontend: Asks question
    Frontend->>API: POST /api/vector-search<br/>{ prompt: question }
    
    par Parallel Execution
        API->>OpenAI: Content Moderation
        and
        API->>OpenAI: Create Embedding<br/>text-embedding-ada-002
    end
    
    OpenAI-->>API: Moderation result
    OpenAI-->>API: 1536-dim query vector
    
    alt Content flagged
        API-->>Frontend: 400 Error: Flagged content
    else Content approved
        API->>API: Convert array to vector string
        API->>DB: SELECT with VEC_DISTANCE()<br/>WHERE similarity > 0.78<br/>ORDER BY distance ASC<br/>LIMIT 10
        DB->>DB: Use vector index for fast search
        DB-->>API: Top matching sections
        
        API->>API: Build context (max 1500 tokens)
        API->>API: Create prompt with context
        
        API->>OpenAI: POST /chat/completions<br/>gpt-3.5-turbo<br/>stream: true
        OpenAI-->>API: Stream chunks
        
        loop Stream chunks
            API-->>Frontend: SSE chunk
            Frontend-->>User: Display text incrementally
        end
        
        API->>API: Append sources metadata
        API-->>Frontend: __SOURCES__ JSON
        Frontend-->>User: Show sources
    end
```

## 🎯 Component Architecture

```mermaid
graph LR
    subgraph "Frontend Layer 🎨"
        A[Next.js Pages<br/>product.tsx, legal.tsx, gtm.tsx]
        B[React Components<br/>ProductAssistant.tsx]
        C[UI Components<br/>shadcn/ui]
    end
    
    subgraph "API Layer 🔌"
        D[vector-search.ts<br/>Product queries]
        E[legal-vector-search.ts<br/>Legal queries]
        F[gtm-vector-search.ts<br/>GTM queries]
        G[upload-*.ts<br/>Document upload]
    end
    
    subgraph "Business Logic 🧠"
        H[generate-embeddings.ts<br/>Indexing pipeline]
        I[lib/db.ts<br/>Connection pooling]
        J[lib/utils.ts<br/>Helpers]
    end
    
    subgraph "External Services 🌐"
        K[OpenAI Embedding API<br/>text-embedding-ada-002]
        L[OpenAI Chat API<br/>gpt-3.5-turbo]
        M[MariaDB Cloud<br/>Vector Database]
    end
    
    A --> B
    B --> C
    A --> D
    A --> E
    A --> F
    D --> K
    D --> L
    D --> M
    E --> K
    E --> L
    E --> M
    F --> K
    F --> L
    F --> M
    G --> H
    H --> K
    H --> M
    D --> I
    E --> I
    F --> I
    H --> I
    
    style K fill:#10a37f
    style L fill:#10a37f
    style M fill:#c49a6c
```

## 💾 Database Schema

```mermaid
erDiagram
    PRODUCTS ||--o{ PRODUCT_SECTIONS : contains
    LEGAL_DOCUMENTS ||--o{ LEGAL_SECTIONS : contains
    GTM_DOCUMENTS ||--o{ GTM_SECTIONS : contains
    
    PRODUCTS {
        bigint id PK
        varchar name
        text description
        json metadata
        timestamp created_at
        timestamp updated_at
    }
    
    PRODUCT_SECTIONS {
        bigint id PK
        bigint product_id FK
        text content
        int token_count
        vector embedding "VECTOR(1536)"
        varchar section_title
        timestamp created_at
    }
    
    LEGAL_DOCUMENTS {
        bigint id PK
        varchar name
        text description
        json metadata
        timestamp created_at
        timestamp updated_at
    }
    
    LEGAL_SECTIONS {
        bigint id PK
        bigint document_id FK
        text content
        int token_count
        vector embedding "VECTOR(1536)"
        varchar section_title
        timestamp created_at
    }
    
    GTM_DOCUMENTS {
        bigint id PK
        varchar name
        text description
        json metadata
        timestamp created_at
        timestamp updated_at
    }
    
    GTM_SECTIONS {
        bigint id PK
        bigint document_id FK
        text content
        int token_count
        vector embedding "VECTOR(1536)"
        varchar section_title
        timestamp created_at
    }
```

## 🔍 Vector Search Query Breakdown

```mermaid
graph TD
    A[User Query:<br/>'How to optimize performance?'] --> B[1. Generate Embedding]
    B --> C[Vector: 0.123, -0.456, ...<br/>1536 dimensions]
    C --> D[2. Convert to MariaDB Format]
    D --> E['[0.123,-0.456,0.789,...]']
    E --> F[3. Execute Vector Search Query]
    
    F --> G[WITH query_vector AS<br/>SELECT Vec_FromText? AS vec]
    G --> H[CROSS JOIN query_vector]
    H --> I[Calculate VEC_DISTANCE<br/>cosine distance]
    I --> J[Filter: similarity > 0.78<br/>1 - VEC_DISTANCE]
    J --> K[ORDER BY distance ASC<br/>Use vector index]
    K --> L[LIMIT 10<br/>Top matches]
    L --> M[Results: Sections with<br/>highest semantic similarity]
    
    style A fill:#e1f5ff
    style C fill:#fff3cd
    style M fill:#d4edda
```

## 🚀 Performance Characteristics

```mermaid
graph LR
    subgraph "Indexing Performance"
        A[Document Processing<br/>~100ms/doc] --> B[Embedding Generation<br/>~200-500ms/section]
        B --> C[Database Insert<br/>~50ms/section]
        C --> D[Total: ~350-650ms/section]
    end
    
    subgraph "Query Performance"
        E[Query Embedding<br/>~200-300ms] --> F[Vector Search<br/>~50-100ms]
        F --> G[Context Building<br/>~10ms]
        G --> H[LLM Generation<br/>~1-3s]
        H --> I[Total: ~1.3-3.4s]
    end
    
    style D fill:#d4edda
    style I fill:#fff3cd
```

## 📈 Cost Breakdown

```mermaid
pie title "Per Query Cost Distribution"
    "Chat API (gpt-3.5-turbo)" : 85
    "Embedding API (query)" : 10
    "Embedding API (indexing)" : 3
    "Database Storage" : 2
```

## 🔐 Security & Validation Flow

```mermaid
graph TD
    A[User Request] --> B{Validate API Key}
    B -->|Missing| C[❌ 500 Error]
    B -->|Present| D{Validate DB Config}
    D -->|Missing| E[❌ 500 Error]
    D -->|Present| F{Method = POST?}
    F -->|No| G[❌ 405 Error]
    F -->|Yes| H{Has Query?}
    H -->|No| I[❌ 400 Error]
    H -->|Yes| J[Content Moderation]
    J --> K{Flagged?}
    K -->|Yes| L[❌ 400 Error<br/>Flagged Content]
    K -->|No| M[Generate Embedding]
    M --> N{Embedding Success?}
    N -->|No| O[❌ 500 Error]
    N -->|Yes| P[Vector Search]
    P --> Q[Generate Response]
    Q --> R{Stream Success?}
    R -->|No| S[❌ 500 Error]
    R -->|Yes| T[✅ 200 Response]
```

## 🎓 Key Design Decisions

### Why Two Phases?

1. **Separation of Concerns**: Indexing happens once (build time), queries happen repeatedly (runtime)
2. **Cost Optimization**: Expensive embedding generation happens once, not per query
3. **Performance**: Pre-indexed vectors enable sub-second similarity search
4. **Scalability**: Can handle millions of documents with efficient indexing

### Why MariaDB Vector Support?

- **Native Type Safety**: `VECTOR(1536)` enforces correct dimensionality
- **Optimized Storage**: Binary representation vs JSON/text
- **Built-in Functions**: `VEC_DISTANCE()`, `Vec_FromText()` native to database
- **Fast Indexes**: Approximate Nearest Neighbor (ANN) algorithms
- **Standard SQL**: Familiar interface with powerful extensions

### Why Cosine Distance?

OpenAI embeddings are normalized (magnitude = 1), making cosine distance ideal for semantic similarity:
- Cosine distance measures angle between vectors (semantic similarity)
- Euclidean distance would measure magnitude (not meaningful for normalized vectors)

### Why Similarity Threshold 0.78?

Based on empirical testing:
- **> 0.78**: Highly relevant matches (rare false positives)
- **0.70-0.78**: Moderately relevant (may include noise)
- **< 0.70**: Often irrelevant

Balances recall (finding relevant content) with precision (avoiding irrelevant content).

## 🛠️ Technology Stack

```mermaid
graph LR
    subgraph "Frontend"
        A[Next.js 13+<br/>React + TypeScript]
        B[Tailwind CSS<br/>shadcn/ui]
    end
    
    subgraph "Backend"
        C[Next.js API Routes<br/>Node.js Runtime]
        D[OpenAI SDK<br/>Embeddings + Chat]
    end
    
    subgraph "Database"
        E[MariaDB Cloud 11.7+<br/>Native VECTOR Support]
        F[mysql2<br/>Connection Pooling]
    end
    
    subgraph "AI Services"
        G[OpenAI Embedding API<br/>text-embedding-ada-002]
        H[OpenAI Chat API<br/>gpt-3.5-turbo]
    end
    
    A --> B
    A --> C
    C --> D
    C --> F
    F --> E
    D --> G
    D --> H
    
    style A fill:#0070f3
    style E fill:#c49a6c
    style G fill:#10a37f
    style H fill:#10a37f
```

## 📚 Related Documentation

- **[README.md](./README.md)** - Main project documentation with setup instructions
- [MariaDB Vector Functions](https://mariadb.com/docs/server/ref/mdb/sql-statements/data-types/vector/) - Official MariaDB vector documentation
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings) - OpenAI embeddings best practices

