import Head from 'next/head'
import { SettingsManager } from '@/components/SettingsManager'

export default function SettingsPage() {
  return (
    <>
      <Head>
        <title>Settings - MariaDB Sales Assistant</title>
        <meta
          name="description"
          content="Upload and manage product information for the MariaDB Sales Assistant"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Upload product information that will be used by the AI assistant to answer questions.
            You can upload text files or paste content directly.
          </p>
        </div>
        <SettingsManager />
      </div>
    </>
  )
}

