-- MariaDB schema for MariaDB Sales Assistant
-- Requires MariaDB 11.7+ for native VECTOR support

-- Products table for storing product information
CREATE TABLE IF NOT EXISTS products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Product sections table for storing product information with embeddings
CREATE TABLE IF NOT EXISTS product_sections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  token_count INT NULL,
  embedding VECTOR(1536) NOT NULL,
  section_title VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create vector index for product sections (functional indexes may need special syntax)
CREATE VECTOR INDEX IF NOT EXISTS idx_product_embedding ON product_sections (embedding) DISTANCE=cosine M=16;

-- Note: MariaDB 11.7+ native vector functions:
-- Vec_FromText('[0.1, 0.2, ...]') - converts text array to VECTOR type
-- VEC_DISTANCE() - generic function, uses cosine or euclidean based on index DISTANCE setting
-- VEC_DISTANCE_COSINE() - explicitly calculates cosine distance (lower = more similar)
-- VEC_DISTANCE_EUCLIDEAN() - explicitly calculates euclidean distance
-- 
-- Index configuration:
-- DISTANCE=cosine - uses cosine distance (best for normalized embeddings like OpenAI's)
-- M=16 - index quality parameter (3-200, larger = more accurate but slower inserts/larger index)
-- Cosine similarity = 1 - cosine distance (for display/threshold purposes)

