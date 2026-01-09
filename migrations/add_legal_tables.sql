-- Migration to add legal documents and legal sections tables
-- Run this against your MariaDB database

-- Legal documents table for storing legal information
CREATE TABLE IF NOT EXISTS legal_documents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Legal sections table for storing legal information with embeddings
CREATE TABLE IF NOT EXISTS legal_sections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  legal_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  token_count INT NULL,
  embedding VECTOR(1536) NOT NULL,
  section_title VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (legal_id) REFERENCES legal_documents(id) ON DELETE CASCADE,
  INDEX idx_legal_id (legal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create vector index for legal sections
CREATE VECTOR INDEX IF NOT EXISTS idx_legal_embedding ON legal_sections (embedding) DISTANCE=cosine M=16;

