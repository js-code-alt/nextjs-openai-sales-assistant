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

interface LegalDocument {
  id: number
  name: string
  description: string | null
  created_at: string
}

interface GTMDocument {
  id: number
  name: string
  description: string | null
  created_at: string
}

type TabType = 'product' | 'legal' | 'gtm'

export function SettingsManager() {
  const [activeTab, setActiveTab] = React.useState<TabType>('product')
  
  // Product state
  const [products, setProducts] = React.useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = React.useState(false)
  const [uploadingProduct, setUploadingProduct] = React.useState(false)
  const [productName, setProductName] = React.useState('')
  const [productContent, setProductContent] = React.useState('')
  const [selectedProductFile, setSelectedProductFile] = React.useState<File | null>(null)
  
  // Legal state
  const [legalDocuments, setLegalDocuments] = React.useState<LegalDocument[]>([])
  const [loadingLegal, setLoadingLegal] = React.useState(false)
  const [uploadingLegal, setUploadingLegal] = React.useState(false)
  const [legalName, setLegalName] = React.useState('')
  const [legalContent, setLegalContent] = React.useState('')
  const [selectedLegalFile, setSelectedLegalFile] = React.useState<File | null>(null)
  
  // GTM state
  const [gtmDocuments, setGtmDocuments] = React.useState<GTMDocument[]>([])
  const [loadingGtm, setLoadingGtm] = React.useState(false)
  const [uploadingGtm, setUploadingGtm] = React.useState(false)
  const [gtmName, setGtmName] = React.useState('')
  const [gtmContent, setGtmContent] = React.useState('')
  const [selectedGtmFile, setSelectedGtmFile] = React.useState<File | null>(null)
  
  // Shared message state
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null)

  React.useEffect(() => {
    if (activeTab === 'product') {
      fetchProducts()
    } else if (activeTab === 'legal') {
      fetchLegalDocuments()
    } else if (activeTab === 'gtm') {
      fetchGtmDocuments()
    }
  }, [activeTab])

  // Fetch products
  const fetchProducts = async () => {
    setLoadingProducts(true)
    try {
      const response = await fetch('/api/products')
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoadingProducts(false)
    }
  }

  // Fetch legal documents
  const fetchLegalDocuments = async () => {
    setLoadingLegal(true)
    try {
      const response = await fetch('/api/legal')
      if (response.ok) {
        const data = await response.json()
        setLegalDocuments(data)
      }
    } catch (error) {
      console.error('Error fetching legal documents:', error)
    } finally {
      setLoadingLegal(false)
    }
  }

  // Fetch GTM documents
  const fetchGtmDocuments = async () => {
    setLoadingGtm(true)
    try {
      const response = await fetch('/api/gtm')
      if (response.ok) {
        const data = await response.json()
        setGtmDocuments(data)
      }
    } catch (error) {
      console.error('Error fetching GTM documents:', error)
    } finally {
      setLoadingGtm(false)
    }
  }

  // Product file select handler
  const handleProductFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedProductFile(file)
      
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setProductContent('')
        return
      }
      
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setProductContent(content)
      }
      reader.readAsText(file)
    }
  }

  // Legal file select handler
  const handleLegalFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedLegalFile(file)
      
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setLegalContent('')
        return
      }
      
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setLegalContent(content)
      }
      reader.readAsText(file)
    }
  }

  // Product submit handler
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!productName.trim()) {
      setMessage({ type: 'error', text: 'Product name is required' })
      return
    }

    if (!selectedProductFile && !productContent.trim()) {
      setMessage({ type: 'error', text: 'Please provide product content or upload a file' })
      return
    }

    setUploadingProduct(true)
    setMessage(null)

    try {
      let response: Response
      
      if (selectedProductFile) {
        const formData = new FormData()
        formData.append('name', productName)
        formData.append('file', selectedProductFile)
        if (productContent.trim()) {
          formData.append('content', productContent)
        }
        
        response = await fetch('/api/upload-product', {
          method: 'POST',
          body: formData,
        })
      } else {
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

      const contentType = response.headers.get('content-type')
      let data
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        throw new Error(text || 'Failed to upload product')
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload product')
      }

      setMessage({ type: 'success', text: 'Product uploaded successfully! Embeddings are being generated...' })
      setProductName('')
      setProductContent('')
      setSelectedProductFile(null)
      
      const fileInput = document.getElementById('product-file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''

      setTimeout(() => {
        fetchProducts()
      }, 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload product' })
    } finally {
      setUploadingProduct(false)
    }
  }

  // Legal submit handler
  const handleLegalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!legalName.trim()) {
      setMessage({ type: 'error', text: 'Document name is required' })
      return
    }

    if (!selectedLegalFile && !legalContent.trim()) {
      setMessage({ type: 'error', text: 'Please provide document content or upload a file' })
      return
    }

    setUploadingLegal(true)
    setMessage(null)

    try {
      let response: Response
      
      if (selectedLegalFile) {
        const formData = new FormData()
        formData.append('name', legalName)
        formData.append('file', selectedLegalFile)
        if (legalContent.trim()) {
          formData.append('content', legalContent)
        }
        
        response = await fetch('/api/upload-legal', {
          method: 'POST',
          body: formData,
        })
      } else {
        response = await fetch('/api/upload-legal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: legalName,
            content: legalContent,
          }),
        })
      }

      const contentType = response.headers.get('content-type')
      let data
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        throw new Error(text || 'Failed to upload legal document')
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload legal document')
      }

      setMessage({ type: 'success', text: 'Legal document uploaded successfully! Embeddings are being generated...' })
      setLegalName('')
      setLegalContent('')
      setSelectedLegalFile(null)
      
      const fileInput = document.getElementById('legal-file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''

      setTimeout(() => {
        fetchLegalDocuments()
      }, 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload legal document' })
    } finally {
      setUploadingLegal(false)
    }
  }

  // Product delete handler
  const handleProductDelete = async (productId: number) => {
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

  // Legal delete handler
  const handleLegalDelete = async (legalId: number) => {
    if (!confirm('Are you sure you want to delete this legal document and all its information?')) {
      return
    }

    try {
      const response = await fetch(`/api/legal/${legalId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete legal document')
      }

      setMessage({ type: 'success', text: 'Legal document deleted successfully' })
      fetchLegalDocuments()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete legal document' })
    }
  }

  // GTM file select handler
  const handleGtmFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedGtmFile(file)
      
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setGtmContent('')
        return
      }
      
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setGtmContent(content)
      }
      reader.readAsText(file)
    }
  }

  // GTM submit handler
  const handleGtmSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!gtmName.trim()) {
      setMessage({ type: 'error', text: 'Document name is required' })
      return
    }

    if (!selectedGtmFile && !gtmContent.trim()) {
      setMessage({ type: 'error', text: 'Please provide document content or upload a file' })
      return
    }

    setUploadingGtm(true)
    setMessage(null)

    try {
      let response: Response
      
      if (selectedGtmFile) {
        const formData = new FormData()
        formData.append('name', gtmName)
        formData.append('file', selectedGtmFile)
        if (gtmContent.trim()) {
          formData.append('content', gtmContent)
        }
        
        response = await fetch('/api/upload-gtm', {
          method: 'POST',
          body: formData,
        })
      } else {
        response = await fetch('/api/upload-gtm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: gtmName,
            content: gtmContent,
          }),
        })
      }

      const contentType = response.headers.get('content-type')
      let data
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        throw new Error(text || 'Failed to upload GTM document')
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload GTM document')
      }

      setMessage({ type: 'success', text: 'GTM document uploaded successfully! Embeddings are being generated...' })
      setGtmName('')
      setGtmContent('')
      setSelectedGtmFile(null)
      
      const fileInput = document.getElementById('gtm-file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''

      setTimeout(() => {
        fetchGtmDocuments()
      }, 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload GTM document' })
    } finally {
      setUploadingGtm(false)
    }
  }

  // GTM delete handler
  const handleGtmDelete = async (gtmId: number) => {
    if (!confirm('Are you sure you want to delete this GTM document and all its information?')) {
      return
    }

    try {
      const response = await fetch(`/api/gtm/${gtmId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete GTM document')
      }

      setMessage({ type: 'success', text: 'GTM document deleted successfully' })
      fetchGtmDocuments()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete GTM document' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('product')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'product'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Product
            </button>
            <button
              onClick={() => setActiveTab('legal')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'legal'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Legal
            </button>
            <button
              onClick={() => setActiveTab('gtm')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'gtm'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              GTM
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
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

          {activeTab === 'product' ? (
            <>
              {/* Product Upload Form */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Upload Product Information
                </h2>

                <form onSubmit={handleProductSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="product-name">Product Name</Label>
                    <Input
                      id="product-name"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="e.g., MariaDB Cloud, MariaDB Enterprise Server"
                      disabled={uploadingProduct}
                    />
                  </div>

                  <div>
                    <Label htmlFor="product-file-input">Upload File (Optional)</Label>
                    <div className="mt-2 flex items-center gap-4">
                      <Input
                        id="product-file-input"
                        type="file"
                        accept=".txt,.md,.markdown,.pdf"
                        onChange={handleProductFileSelect}
                        disabled={uploadingProduct}
                        className="cursor-pointer"
                      />
                      {selectedProductFile && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          {selectedProductFile.type === 'application/pdf' || selectedProductFile.name.toLowerCase().endsWith('.pdf') ? (
                            <File className="h-4 w-4 text-red-500" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          <span>{selectedProductFile.name}</span>
                          <span className="text-xs text-gray-500">
                            ({(selectedProductFile.size / 1024).toFixed(2)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductFile(null)
                              setProductContent('')
                              const fileInput = document.getElementById('product-file-input') as HTMLInputElement
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
                      Product Information {selectedProductFile && <span className="ml-2 text-sm text-gray-500 font-normal">(Optional - file will be processed)</span>}
                    </Label>
                    <textarea
                      id="product-content"
                      value={productContent}
                      onChange={(e) => setProductContent(e.target.value)}
                      placeholder={
                        selectedProductFile
                          ? "Optional: Add additional text here if needed. The file will be processed automatically."
                          : "Paste product information here, or upload a file above..."
                      }
                      className="w-full min-h-[300px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={uploadingProduct}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button 
                      type="submit" 
                      disabled={uploadingProduct || !productName.trim() || (!selectedProductFile && !productContent.trim())}
                    >
                      {uploadingProduct ? (
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

              {/* Product List */}
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Uploaded Products
                </h2>

                {loadingProducts ? (
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
                          onClick={() => handleProductDelete(product.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : activeTab === 'legal' ? (
            <>
              {/* Legal Upload Form */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Upload Legal Document
                </h2>

                <form onSubmit={handleLegalSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="legal-name">Document Name</Label>
                    <Input
                      id="legal-name"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      placeholder="e.g., Terms of Service, Privacy Policy, Contract Template"
                      disabled={uploadingLegal}
                    />
                  </div>

                  <div>
                    <Label htmlFor="legal-file-input">Upload File (Optional)</Label>
                    <div className="mt-2 flex items-center gap-4">
                      <Input
                        id="legal-file-input"
                        type="file"
                        accept=".txt,.md,.markdown,.pdf"
                        onChange={handleLegalFileSelect}
                        disabled={uploadingLegal}
                        className="cursor-pointer"
                      />
                      {selectedLegalFile && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          {selectedLegalFile.type === 'application/pdf' || selectedLegalFile.name.toLowerCase().endsWith('.pdf') ? (
                            <File className="h-4 w-4 text-red-500" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          <span>{selectedLegalFile.name}</span>
                          <span className="text-xs text-gray-500">
                            ({(selectedLegalFile.size / 1024).toFixed(2)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLegalFile(null)
                              setLegalContent('')
                              const fileInput = document.getElementById('legal-file-input') as HTMLInputElement
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
                    <Label htmlFor="legal-content">
                      Document Content {selectedLegalFile && <span className="ml-2 text-sm text-gray-500 font-normal">(Optional - file will be processed)</span>}
                    </Label>
                    <textarea
                      id="legal-content"
                      value={legalContent}
                      onChange={(e) => setLegalContent(e.target.value)}
                      placeholder={
                        selectedLegalFile
                          ? "Optional: Add additional text here if needed. The file will be processed automatically."
                          : "Paste legal document content here, or upload a file above..."
                      }
                      className="w-full min-h-[300px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={uploadingLegal}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button 
                      type="submit" 
                      disabled={uploadingLegal || !legalName.trim() || (!selectedLegalFile && !legalContent.trim())}
                    >
                      {uploadingLegal ? (
                        <>
                          <Loader className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Document
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Legal List */}
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Uploaded Legal Documents
                </h2>

                {loadingLegal ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : legalDocuments.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>No legal documents uploaded yet. Upload your first document above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {legalDocuments.map((document) => (
                      <div
                        key={document.id}
                        className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white">{document.name}</h3>
                          {document.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                              {document.description}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Uploaded: {new Date(document.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleLegalDelete(document.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* GTM Upload Form */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Upload GTM Document
                </h2>

                <form onSubmit={handleGtmSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="gtm-name">Document Name</Label>
                    <Input
                      id="gtm-name"
                      value={gtmName}
                      onChange={(e) => setGtmName(e.target.value)}
                      placeholder="e.g., MariaDB vs MySQL, MariaDB vs PostgreSQL, Competitive Positioning Guide"
                      disabled={uploadingGtm}
                    />
                  </div>

                  <div>
                    <Label htmlFor="gtm-file-input">Upload File (Optional)</Label>
                    <div className="mt-2 flex items-center gap-4">
                      <Input
                        id="gtm-file-input"
                        type="file"
                        accept=".txt,.md,.markdown,.pdf"
                        onChange={handleGtmFileSelect}
                        disabled={uploadingGtm}
                        className="cursor-pointer"
                      />
                      {selectedGtmFile && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          {selectedGtmFile.type === 'application/pdf' || selectedGtmFile.name.toLowerCase().endsWith('.pdf') ? (
                            <File className="h-4 w-4 text-red-500" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          <span>{selectedGtmFile.name}</span>
                          <span className="text-xs text-gray-500">
                            ({(selectedGtmFile.size / 1024).toFixed(2)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedGtmFile(null)
                              setGtmContent('')
                              const fileInput = document.getElementById('gtm-file-input') as HTMLInputElement
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
                    <Label htmlFor="gtm-content">
                      Document Content {selectedGtmFile && <span className="ml-2 text-sm text-gray-500 font-normal">(Optional - file will be processed)</span>}
                    </Label>
                    <textarea
                      id="gtm-content"
                      value={gtmContent}
                      onChange={(e) => setGtmContent(e.target.value)}
                      placeholder={
                        selectedGtmFile
                          ? "Optional: Add additional text here if needed. The file will be processed automatically."
                          : "Paste GTM/competitive positioning content here, or upload a file above..."
                      }
                      className="w-full min-h-[300px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={uploadingGtm}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button 
                      type="submit" 
                      disabled={uploadingGtm || !gtmName.trim() || (!selectedGtmFile && !gtmContent.trim())}
                    >
                      {uploadingGtm ? (
                        <>
                          <Loader className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Document
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </div>

              {/* GTM List */}
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Uploaded GTM Documents
                </h2>

                {loadingGtm ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : gtmDocuments.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>No GTM documents uploaded yet. Upload your first document above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {gtmDocuments.map((document) => (
                      <div
                        key={document.id}
                        className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white">{document.name}</h3>
                          {document.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                              {document.description}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Uploaded: {new Date(document.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleGtmDelete(document.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
