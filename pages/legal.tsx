import Head from 'next/head'
import { LegalAssistant } from '@/components/LegalAssistant'

export default function LegalPage() {
  return (
    <>
      <Head>
        <title>Legal - MariaDB Sales Assistant</title>
        <meta
          name="description"
          content="Ask questions about legal documents and information"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Legal Assistant
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Ask questions about legal documents. The AI assistant will help you find
            information you need from your uploaded legal documents.
          </p>
        </div>
        <LegalAssistant />
      </div>
    </>
  )
}

