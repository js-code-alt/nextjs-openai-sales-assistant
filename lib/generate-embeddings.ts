import { getDbPool, closeDbPool, arrayToVectorString } from './db'
import { createHash } from 'crypto'
import dotenv from 'dotenv'
import { ObjectExpression } from 'estree'
import { readdir, readFile, stat } from 'fs/promises'
import GithubSlugger from 'github-slugger'
import { Content, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mdxFromMarkdown, MdxjsEsm } from 'mdast-util-mdx'
import { toMarkdown } from 'mdast-util-to-markdown'
import { toString } from 'mdast-util-to-string'
import { mdxjs } from 'micromark-extension-mdxjs'
import 'openai'
import { Configuration, OpenAIApi } from 'openai'
import { basename, dirname, join } from 'path'
import { u } from 'unist-builder'
import { filter } from 'unist-util-filter'
import { inspect } from 'util'
import yargs from 'yargs'

dotenv.config()

const ignoredFiles = ['pages/404.mdx']

/**
 * Extracts ES literals from an `estree` `ObjectExpression`
 * into a plain JavaScript object.
 */
function getObjectFromExpression(node: ObjectExpression) {
  return node.properties.reduce<
    Record<string, string | number | bigint | true | RegExp | undefined>
  >((object, property) => {
    if (property.type !== 'Property') {
      return object
    }

    const key = (property.key.type === 'Identifier' && property.key.name) || undefined
    const value = (property.value.type === 'Literal' && property.value.value) || undefined

    if (!key) {
      return object
    }

    return {
      ...object,
      [key]: value,
    }
  }, {})
}

/**
 * Extracts the `meta` ESM export from the MDX file.
 *
 * This info is akin to frontmatter.
 */
function extractMetaExport(mdxTree: Root) {
  const metaExportNode = mdxTree.children.find((node): node is MdxjsEsm => {
    return (
      node.type === 'mdxjsEsm' &&
      node.data?.estree?.body[0]?.type === 'ExportNamedDeclaration' &&
      node.data.estree.body[0].declaration?.type === 'VariableDeclaration' &&
      node.data.estree.body[0].declaration.declarations[0]?.id.type === 'Identifier' &&
      node.data.estree.body[0].declaration.declarations[0].id.name === 'meta'
    )
  })

  if (!metaExportNode) {
    return undefined
  }

  const objectExpression =
    (metaExportNode.data?.estree?.body[0]?.type === 'ExportNamedDeclaration' &&
      metaExportNode.data.estree.body[0].declaration?.type === 'VariableDeclaration' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0]?.id.type === 'Identifier' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].id.name === 'meta' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].init?.type ===
        'ObjectExpression' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].init) ||
    undefined

  if (!objectExpression) {
    return undefined
  }

  return getObjectFromExpression(objectExpression)
}

/**
 * Splits a `mdast` tree into multiple trees based on
 * a predicate function. Will include the splitting node
 * at the beginning of each tree.
 *
 * Useful to split a markdown file into smaller sections.
 */
function splitTreeBy(tree: Root, predicate: (node: Content) => boolean) {
  return tree.children.reduce<Root[]>((trees, node) => {
    const [lastTree] = trees.slice(-1)

    if (!lastTree || predicate(node)) {
      const tree: Root = u('root', [node])
      return trees.concat(tree)
    }

    lastTree.children.push(node)
    return trees
  }, [])
}

type Meta = ReturnType<typeof extractMetaExport>

type Section = {
  content: string
  heading?: string
  slug?: string
}

type ProcessedMdx = {
  checksum: string
  meta: Meta
  sections: Section[]
}

/**
 * Processes MDX content for search indexing.
 * It extracts metadata, strips it of all JSX,
 * and splits it into sub-sections based on criteria.
 */
function processMdxForSearch(content: string): ProcessedMdx {
  const checksum = createHash('sha256').update(content).digest('base64')

  const mdxTree = fromMarkdown(content, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  })

  const meta = extractMetaExport(mdxTree)

  // Remove all MDX elements from markdown
  const mdTree = filter(
    mdxTree,
    (node) =>
      ![
        'mdxjsEsm',
        'mdxJsxFlowElement',
        'mdxJsxTextElement',
        'mdxFlowExpression',
        'mdxTextExpression',
      ].includes(node.type)
  )

  if (!mdTree) {
    return {
      checksum,
      meta,
      sections: [],
    }
  }

  const sectionTrees = splitTreeBy(mdTree, (node) => node.type === 'heading')

  const slugger = new GithubSlugger()

  const sections = sectionTrees.map((tree) => {
    const [firstNode] = tree.children

    const heading = firstNode.type === 'heading' ? toString(firstNode) : undefined
    const slug = heading ? slugger.slug(heading) : undefined

    return {
      content: toMarkdown(tree),
      heading,
      slug,
    }
  })

  return {
    checksum,
    meta,
    sections,
  }
}

type WalkEntry = {
  path: string
  parentPath?: string
}

async function walk(dir: string, parentPath?: string): Promise<WalkEntry[]> {
  const immediateFiles = await readdir(dir)

  const recursiveFiles = await Promise.all(
    immediateFiles.map(async (file) => {
      const path = join(dir, file)
      const stats = await stat(path)
      if (stats.isDirectory()) {
        // Keep track of document hierarchy (if this dir has corresponding doc file)
        const docPath = `${basename(path)}.mdx`

        return walk(
          path,
          immediateFiles.includes(docPath) ? join(dirname(path), docPath) : parentPath
        )
      } else if (stats.isFile()) {
        return [
          {
            path: path,
            parentPath,
          },
        ]
      } else {
        return []
      }
    })
  )

  const flattenedFiles = recursiveFiles.reduce(
    (all, folderContents) => all.concat(folderContents),
    []
  )

  return flattenedFiles.sort((a, b) => a.path.localeCompare(b.path))
}

abstract class BaseEmbeddingSource {
  checksum?: string
  meta?: Meta
  sections?: Section[]

  constructor(public source: string, public path: string, public parentPath?: string) {}

  abstract load(): Promise<{
    checksum: string
    meta?: Meta
    sections: Section[]
  }>
}

class MarkdownEmbeddingSource extends BaseEmbeddingSource {
  type: 'markdown' = 'markdown'

  constructor(source: string, public filePath: string, public parentFilePath?: string) {
    const path = filePath.replace(/^pages/, '').replace(/\.mdx?$/, '')
    const parentPath = parentFilePath?.replace(/^pages/, '').replace(/\.mdx?$/, '')

    super(source, path, parentPath)
  }

  async load() {
    const contents = await readFile(this.filePath, 'utf8')

    const { checksum, meta, sections } = processMdxForSearch(contents)

    this.checksum = checksum
    this.meta = meta
    this.sections = sections

    return {
      checksum,
      meta,
      sections,
    }
  }
}

type EmbeddingSource = MarkdownEmbeddingSource

async function generateEmbeddings() {
  const argv = await yargs.option('refresh', {
    alias: 'r',
    description: 'Refresh data',
    type: 'boolean',
  }).argv

  const shouldRefresh = argv.refresh

  const dbHost = process.env.DB_HOST || process.env.MARIADB_HOST
  const dbUser = process.env.DB_USER || process.env.MARIADB_USER
  const dbPassword = process.env.DB_PASSWORD || process.env.MARIADB_PASSWORD
  const dbName = process.env.DB_NAME || process.env.MARIADB_DATABASE

  if (!dbHost || !dbUser || !dbPassword || !dbName || !process.env.OPENAI_KEY) {
    return console.log(
      'Environment variables DB_HOST (or MARIADB_HOST), DB_USER (or MARIADB_USER), DB_PASSWORD (or MARIADB_PASSWORD), DB_NAME (or MARIADB_DATABASE), and OPENAI_KEY are required: skipping embeddings generation'
    )
  }

  const pool = getDbPool()

  const embeddingSources: EmbeddingSource[] = [
    ...(await walk('pages'))
      .filter(({ path }) => /\.mdx?$/.test(path))
      .filter(({ path }) => !ignoredFiles.includes(path))
      .map((entry) => new MarkdownEmbeddingSource('guide', entry.path)),
  ]

  console.log(`Discovered ${embeddingSources.length} pages`)

  if (!shouldRefresh) {
    console.log('Checking which pages are new or have changed')
  } else {
    console.log('Refresh flag set, re-generating all pages')
  }

  for (const embeddingSource of embeddingSources) {
    const { type, source, path, parentPath } = embeddingSource

    try {
      const { checksum, meta, sections } = await embeddingSource.load()

      // Check for existing page in DB and compare checksums
      const [existingPageRows] = await pool.execute(
        'SELECT id, path, checksum, parent_page_id FROM nods_page WHERE path = ? LIMIT 1',
        [path]
      )
      const existingPageRowsArray = existingPageRows as Array<{
        id: number
        path: string
        checksum: string | null
        parent_page_id: number | null
      }>
      const existingPage = existingPageRowsArray[0]

      // We use checksum to determine if this page & its sections need to be regenerated
      if (!shouldRefresh && existingPage?.checksum === checksum) {
        // If parent page changed, update it
        if (existingPage?.parent_page_id && parentPath) {
          const [parentPageRows] = await pool.execute(
            'SELECT id FROM nods_page WHERE path = ? LIMIT 1',
            [parentPath]
          )
          const parentPageRowsArray = parentPageRows as Array<{ id: number }>
          const parentPage = parentPageRowsArray[0]

          if (parentPage) {
            // Check if parent actually changed
            const [currentParentRows] = await pool.execute(
              'SELECT id, path FROM nods_page WHERE id = ? LIMIT 1',
              [existingPage.parent_page_id]
            )
            const currentParentRowsArray = currentParentRows as Array<{ id: number; path: string }>
            const currentParent = currentParentRowsArray[0]

            if (currentParent?.path !== parentPath) {
              console.log(`[${path}] Parent page has changed. Updating to '${parentPath}'...`)
              await pool.execute(
                'UPDATE nods_page SET parent_page_id = ? WHERE id = ?',
                [parentPage.id, existingPage.id]
              )
            }
          }
        }
        continue
      }

      if (existingPage) {
        if (!shouldRefresh) {
          console.log(
            `[${path}] Docs have changed, removing old page sections and their embeddings`
          )
        } else {
          console.log(`[${path}] Refresh flag set, removing old page sections and their embeddings`)
        }

        await pool.execute('DELETE FROM nods_page_section WHERE page_id = ?', [existingPage.id])
      }

      // Get parent page if exists
      let parentPageId: number | null = null
      if (parentPath) {
        const [parentPageRows] = await pool.execute(
          'SELECT id FROM nods_page WHERE path = ? LIMIT 1',
          [parentPath]
        )
        const parentPageRowsArray = parentPageRows as Array<{ id: number }>
        const parentPage = parentPageRowsArray[0]
        parentPageId = parentPage?.id || null
      }

      // Create/update page record. Intentionally clear checksum until we
      // have successfully generated all page sections.
      let pageId: number
      if (existingPage) {
        await pool.execute(
          'UPDATE nods_page SET checksum = NULL, type = ?, source = ?, meta = ?, parent_page_id = ? WHERE id = ?',
          [
            type || null,
            source || null,
            meta ? JSON.stringify(meta) : null,
            parentPageId,
            existingPage.id,
          ]
        )
        pageId = existingPage.id
      } else {
        const [insertResult] = await pool.execute(
          'INSERT INTO nods_page (path, checksum, type, source, meta, parent_page_id) VALUES (?, NULL, ?, ?, ?, ?)',
          [path, type || null, source || null, meta ? JSON.stringify(meta) : null, parentPageId]
        )
        const insertResultArray = insertResult as { insertId: number }
        pageId = insertResultArray.insertId
      }

      console.log(`[${path}] Adding ${sections.length} page sections (with embeddings)`)
      for (const { slug, heading, content } of sections) {
        // OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
        const input = content.replace(/\n/g, ' ')

        try {
          const configuration = new Configuration({
            apiKey: process.env.OPENAI_KEY,
          })
          const openai = new OpenAIApi(configuration)

          const embeddingResponse = await openai.createEmbedding({
            model: 'text-embedding-ada-002',
            input,
          })

          if (embeddingResponse.status !== 200) {
            throw new Error(inspect(embeddingResponse.data, false, 2))
          }

          const [responseData] = embeddingResponse.data.data

          // Convert embedding array to MariaDB VECTOR format string
          const embeddingVectorString = arrayToVectorString(responseData.embedding)

          await pool.execute(
            'INSERT INTO nods_page_section (page_id, slug, heading, content, token_count, embedding) VALUES (?, ?, ?, ?, ?, Vec_FromText(?))',
            [
              pageId,
              slug || null,
              heading || null,
              content || null,
              embeddingResponse.data.usage.total_tokens,
              embeddingVectorString,
            ]
          )
        } catch (err) {
          // TODO: decide how to better handle failed embeddings
          console.error(
            `Failed to generate embeddings for '${path}' page section starting with '${input.slice(
              0,
              40
            )}...'`
          )

          throw err
        }
      }

      // Set page checksum so that we know this page was stored successfully
      await pool.execute('UPDATE nods_page SET checksum = ? WHERE id = ?', [checksum, pageId])
    } catch (err) {
      console.error(
        `Page '${path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`
      )
      console.error(err)
    }
  }

  console.log('Embedding generation complete')
}

async function main() {
  try {
    await generateEmbeddings()
  } finally {
    await closeDbPool()
  }
}

main().catch((err) => {
  console.error(err)
  closeDbPool().finally(() => process.exit(1))
})
