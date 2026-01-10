-- Migration to add GTM (Go-to-market) documents and GTM sections tables
-- Run this against your MariaDB database

-- GTM documents table for storing go-to-market positioning information
CREATE TABLE IF NOT EXISTS gtm_documents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GTM sections table for storing GTM information with embeddings
CREATE TABLE IF NOT EXISTS gtm_sections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  gtm_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  token_count INT NULL,
  embedding VECTOR(1536) NOT NULL,
  section_title VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gtm_id) REFERENCES gtm_documents(id) ON DELETE CASCADE,
  INDEX idx_gtm_id (gtm_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create vector index for GTM sections
CREATE VECTOR INDEX IF NOT EXISTS idx_gtm_embedding ON gtm_sections (embedding) DISTANCE=cosine M=16;

