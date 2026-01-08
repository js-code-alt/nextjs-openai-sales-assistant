'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileText, X, Loader, CheckCircle, AlertCircle, File } from 'lucide-react'

interface Product {
  id: number
  name: string
  description: string | null
  created_at: string
}

export function SettingsManager() {
  const [products, setProducts] = React.useState<Product[]>([])
  const [loading, setLoading] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [productName, setProductName] = React.useState('')
  const [productContent, setProductContent] = React.useState('')
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null)

  React.useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/products')
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      
      // If it's a PDF, we'll let the server handle it
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // For PDFs, we won't preview the content on the client
        // The server will extract the text
        setProductContent('') // Clear any existing content
        return
      }
      
      // For text files, read them normally
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setProductContent(content)
      }
      reader.readAsText(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!productName.trim()) {
      setMessage({ type: 'error', text: 'Product name is required' })
      return
    }

    // If no file and no content, show error
    if (!selectedFile && !productContent.trim()) {
      setMessage({ type: 'error', text: 'Please provide product content or upload a file' })
      return
    }

    setUploading(true)
    setMessage(null)

    try {
      let response: Response
      
      // If we have a file (especially PDF), use FormData
      if (selectedFile) {
        const formData = new FormData()
        formData.append('name', productName)
        formData.append('file', selectedFile)
        // Also include text content if provided (for text files)
        if (productContent.trim()) {
          formData.append('content', productContent)
        }
        
        response = await fetch('/api/upload-product', {
          method: 'POST',
          body: formData,
        })
      } else {
        // For text-only uploads, use JSON
        response = await fetch('/api/upload-product', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: productName,
            content: productContent,
          }),
        })
      }

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type')
      let data
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        // If not JSON, read as text and create error
        const text = await response.text()
        throw new Error(text || 'Failed to upload product')
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload product')
      }

      setMessage({ type: 'success', text: 'Product uploaded successfully! Embeddings are being generated...' })
      setProductName('')
      setProductContent('')
      setSelectedFile(null)
      
      // Reset file input
      const fileInput = document.getElementById('file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''

      // Refresh products list
      setTimeout(() => {
        fetchProducts()
      }, 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload product' })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (productId: number) => {
    if (!confirm('Are you sure you want to delete this product and all its information?')) {
      return
    }

    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete product')
      }

      setMessage({ type: 'success', text: 'Product deleted successfully' })
      fetchProducts()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete product' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Upload Product Information
        </h2>

        {message && (
          <div
            className={`mb-4 p-4 rounded-lg flex items-center gap-3 ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="ml-auto"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="product-name">Product Name</Label>
            <Input
              id="product-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g., MariaDB SkySQL, MariaDB Enterprise Server"
              disabled={uploading}
            />
          </div>

          <div>
            <Label htmlFor="file-input">Upload File (Optional)</Label>
            <div className="mt-2 flex items-center gap-4">
              <Input
                id="file-input"
                type="file"
                accept=".txt,.md,.markdown,.pdf"
                onChange={handleFileSelect}
                disabled={uploading}
                className="cursor-pointer"
              />
              {selectedFile && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  {selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf') ? (
                    <File className="h-4 w-4 text-red-500" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  <span>{selectedFile.name}</span>
                  <span className="text-xs text-gray-500">
                    ({(selectedFile.size / 1024).toFixed(2)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null)
                      setProductContent('')
                      const fileInput = document.getElementById('file-input') as HTMLInputElement
                      if (fileInput) fileInput.value = ''
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="product-content">
              Product Information {selectedFile && <span className="ml-2 text-sm text-gray-500 font-normal">(Optional - file will be processed)</span>}
            </Label>
            <textarea
              id="product-content"
              value={productContent}
              onChange={(e) => setProductContent(e.target.value)}
              placeholder={
                selectedFile
                  ? "Optional: Add additional text here if needed. The file will be processed automatically."
                  : "Paste product information here, or upload a file above..."
              }
              className="w-full min-h-[300px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={uploading}
            />
          </div>

          <div className="flex justify-end">
            <Button 
              type="submit" 
              disabled={uploading || !productName.trim() || (!selectedFile && !productContent.trim())}
            >
              {uploading ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Product
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Uploaded Products
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No products uploaded yet. Upload your first product above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{product.name}</h3>
                  {product.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Uploaded: {new Date(product.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(product.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

