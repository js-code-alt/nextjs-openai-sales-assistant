import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/product')
  }, [router])

  return (
    <>
      <Head>
        <title>Ai Sales Assistant</title>
        <meta
          name="description"
          content="AI Sales Assistant for MariaDB products powered by OpenAI and MariaDB Cloud with vector capabilities."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600 dark:text-gray-400">Redirecting...</p>
      </div>
    </>
  )
}
