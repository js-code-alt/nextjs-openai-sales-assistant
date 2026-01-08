import Head from 'next/head'
import { ProductAssistant } from '@/components/ProductAssistant'

export default function ProductPage() {
  return (
    <>
      <Head>
        <title>Product - MariaDB Sales Assistant</title>
        <meta
          name="description"
          content="Ask questions about MariaDB products and services"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Product Assistant
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Ask questions about MariaDB products and services. The AI assistant will help you find
            information you need to sell MariaDB products to your customers.
          </p>
        </div>
        <ProductAssistant />
      </div>
    </>
  )
}

