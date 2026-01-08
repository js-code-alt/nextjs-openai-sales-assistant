import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <title>MariaDB Sales Assistant</title>
        <meta name="description" content="AI Sales Assistant for MariaDB products powered by OpenAI and MariaDB Cloud with vector capabilities." />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
