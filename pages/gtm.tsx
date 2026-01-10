import Head from 'next/head'
import { GTMAssistant } from '@/components/GTMAssistant'

export default function GTMPage() {
  return (
    <>
      <Head>
        <title>GTM - Go-to-market - MariaDB Sales Assistant</title>
        <meta
          name="description"
          content="Ask questions about go-to-market strategies and competitive positioning for MariaDB"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            GTM - Go-to-market Assistant
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Ask questions about competitive positioning and go-to-market strategies. The AI assistant will help you
            understand how to position MariaDB against competitors and develop effective go-to-market approaches to
            win deals with customers and prospects.
          </p>
        </div>
        <GTMAssistant />
      </div>
    </>
  )
}

