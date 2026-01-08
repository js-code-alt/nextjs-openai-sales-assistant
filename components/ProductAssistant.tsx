'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCompletion } from 'ai/react'
import { X, Loader, User, Frown, CornerDownLeft, Search, Wand, RotateCw, Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Typing indicator component with animated dots (ChatGPT-style)
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      <div className="flex gap-1.5 px-1">
        <span 
          className="h-2 w-2 bg-gray-400 dark:bg-gray-400 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '0ms' }}
        ></span>
        <span 
          className="h-2 w-2 bg-gray-400 dark:bg-gray-400 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '160ms' }}
        ></span>
        <span 
          className="h-2 w-2 bg-gray-400 dark:bg-gray-400 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '320ms' }}
        ></span>
      </div>
    </div>
  )
}

// Markdown renderer component with custom styling
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-response">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-6 mb-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-5 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2">{children}</h3>,
          p: ({ children }) => <p className="text-gray-700 dark:text-gray-300 leading-relaxed my-3">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc list-inside my-4 space-y-2 text-gray-700 dark:text-gray-300 ml-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-4 space-y-2 text-gray-700 dark:text-gray-300 ml-4">{children}</ol>,
          li: ({ children }) => <li className="ml-2">{children}</li>,
          a: ({ href, children }) => <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
          code: ({ inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '')
            return inline ? (
              <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono text-gray-900 dark:text-gray-100" {...props}>
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }: any) => (
            <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto my-4 border border-gray-200 dark:border-gray-700">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-4 text-gray-600 dark:text-gray-400">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// Sources list component
function SourcesList({ sources }: { 
  sources: Array<{
    id: number
    product_name: string
    section_title: string | null
    similarity: number
  }>
}) {
  if (!sources || sources.length === 0) return null
  
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
        Sources:
      </p>
      <div className="space-y-2">
        {sources.map((source, idx) => (
          <div 
            key={source.id || idx}
            className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 p-2 rounded"
          >
            <span className="font-medium">{source.product_name}</span>
            {source.section_title && (
              <> - <span>{source.section_title}</span></>
            )}
            <span className="ml-2 text-gray-400 dark:text-gray-500">
              ({Math.round(source.similarity * 100)}% match)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

type ChatMessage = {
  query: string
  response: string
  sources?: Array<{
    id: number
    product_name: string
    section_title: string | null
    similarity: number
  }>
}

export function ProductAssistant() {
  const [query, setQuery] = React.useState<string>('')
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [currentQuery, setCurrentQuery] = React.useState<string>('')
  const [suggestedQuestions, setSuggestedQuestions] = React.useState<string[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(false)

  const { complete, completion, isLoading, error } = useCompletion({
    api: '/api/vector-search',
    onFinish: (prompt, completion) => {
      // Parse sources from completion
      const sourcesMatch = completion.match(/__SOURCES__:(.+)$/s)
      let sources = undefined
      let cleanCompletion = completion
      
      if (sourcesMatch) {
        try {
          sources = JSON.parse(sourcesMatch[1])
          // Remove sources marker from display
          cleanCompletion = completion.replace(/__SOURCES__:.+$/s, '').trim()
        } catch (e) {
          console.error('Failed to parse sources:', e)
        }
      }
      
      setChatHistory((prev) => [...prev, { 
        query: prompt, 
        response: cleanCompletion,
        sources 
      }])
      setIsSubmitting(false)
      setCurrentQuery('')
    },
  })

  // Fetch suggested questions when component mounts and there's no chat history
  React.useEffect(() => {
    if (chatHistory.length === 0 && !isLoading && !isLoadingSuggestions) {
      setIsLoadingSuggestions(true)
      fetch('/api/suggested-questions')
        .then((res) => res.json())
        .then((data) => {
          if (data.questions && Array.isArray(data.questions)) {
            setSuggestedQuestions(data.questions)
          }
        })
        .catch((err) => {
          console.error('Failed to fetch suggested questions:', err)
        })
        .finally(() => {
          setIsLoadingSuggestions(false)
        })
    }
  }, [chatHistory.length, isLoading])

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    if (!query.trim() || isLoading) return
    
    const queryToSubmit = query.trim()
    setIsSubmitting(true)
    setCurrentQuery(queryToSubmit)
    setQuery('')
    setSuggestedQuestions([]) // Hide suggestions once user starts chatting
    complete(queryToSubmit)
  }

  const handleSuggestedQuestionClick = (question: string) => {
    if (isLoading) return
    
    setIsSubmitting(true)
    setCurrentQuery(question)
    setQuery('')
    setSuggestedQuestions([]) // Hide suggestions
    complete(question)
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleNewChat = () => {
    setChatHistory([])
    setQuery('')
    setCurrentQuery('')
    setSuggestedQuestions([])
    setIsSubmitting(false)
  }

  const allHistory = React.useMemo(() => {
    const history = [...chatHistory]
    if (isLoading && currentQuery) {
      history.push({ query: currentQuery, response: completion || '' })
    }
    return history
  }, [chatHistory, isLoading, currentQuery, completion])

  return (
    <div className="w-full">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 min-h-[600px] flex flex-col">
        <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Ask about Products
          </h2>
          <div className="flex gap-2">
            <Button
              onClick={handleNewChat}
              disabled={isLoading || chatHistory.length === 0}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RotateCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mb-4 space-y-6">
          {allHistory.length === 0 && !isLoading && (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <Search className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="mb-6">Start by asking a question about MariaDB products...</p>
              
              {/* Suggested Questions */}
              {suggestedQuestions.length > 0 && (
                <div className="max-w-3xl mx-auto">
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">Suggested questions:</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {suggestedQuestions.map((question, index) => (
                      <button
                        key={index}
                        onClick={() => handleSuggestedQuestionClick(question)}
                        disabled={isLoading}
                        className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-full transition-colors duration-200 border border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {isLoadingSuggestions && (
                <div className="mt-4">
                  <Loader className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                </div>
              )}
            </div>
          )}

          {allHistory.map((item, index) => (
            <div key={index} className="space-y-4">
              <div className="flex gap-4">
                <span className="bg-blue-100 dark:bg-blue-900 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center flex-shrink-0">
                  <User width={18} className="text-blue-600 dark:text-blue-300" />
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-white">{item.query}</p>
                </div>
              </div>

              {isLoading && index === allHistory.length - 1 ? (
                <div className="flex gap-4">
                  <span className="bg-green-100 dark:bg-green-900 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center flex-shrink-0">
                    <Wand width={18} className="text-green-600 dark:text-green-300" />
                  </span>
                  <div className="flex-1">
                    {completion && completion.trim() ? (
                      <>
                        <MarkdownContent content={completion.replace(/__SOURCES__:.+$/s, '').trim()} />
                        {/* Sources will be shown after onFinish when the response is complete */}
                      </>
                    ) : (
                      <TypingIndicator />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <span className="bg-green-100 dark:bg-green-900 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center flex-shrink-0">
                    <Wand width={18} className="text-green-600 dark:text-green-300" />
                  </span>
                  <div className="flex-1">
                    <MarkdownContent content={item.response} />
                    {item.sources && <SourcesList sources={item.sources} />}
                  </div>
                </div>
              )}
            </div>
          ))}

          {error && (
            <div className="flex items-center gap-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <span className="bg-red-100 dark:bg-red-900 p-2 w-8 h-8 rounded-full text-center flex items-center justify-center">
                <Frown width={18} className="text-red-600 dark:text-red-300" />
              </span>
              <span className="text-red-700 dark:text-red-300">
                {error.message || 'An error occurred. Please try again.'}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-auto">
          <div className="relative">
            <Input
              placeholder="Ask a question about MariaDB products..."
              name="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
              className="pr-10"
            />
            <CornerDownLeft
              className={`absolute top-3 right-5 h-4 w-4 text-gray-300 transition-opacity ${
                query && !isLoading ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={!query.trim() || isLoading} className="bg-blue-600 hover:bg-blue-700">
              {isLoading ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Asking...
                </>
              ) : (
                'Ask'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

