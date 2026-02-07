import { GraphQLClient } from 'graphql-request';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let client: GraphQLClient | null = null;

function getClient(): GraphQLClient {
  if (!client) {
    client = new GraphQLClient(`${config.wikiUrl}/graphql`, {
      headers: config.wikiApiToken ? { Authorization: `Bearer ${config.wikiApiToken}` } : {},
    });
  }
  return client;
}

export interface WikiPage {
  id: number;
  path: string;
  title: string;
}

export async function createPage(params: {
  path: string;
  title: string;
  content: string;
  description?: string;
  tags?: string[];
  scriptCss?: string;
  scriptJs?: string;
}): Promise<WikiPage> {
  const mutation = `
    mutation CreatePage(
      $content: String!
      $description: String!
      $editor: String!
      $isPublished: Boolean!
      $isPrivate: Boolean!
      $locale: String!
      $path: String!
      $tags: [String]!
      $title: String!
      $scriptCss: String
      $scriptJs: String
    ) {
      pages {
        create(
          content: $content
          description: $description
          editor: $editor
          isPublished: $isPublished
          isPrivate: $isPrivate
          locale: $locale
          path: $path
          tags: $tags
          title: $title
          scriptCss: $scriptCss
          scriptJs: $scriptJs
        ) {
          responseResult { succeeded errorCode message }
          page { id path title }
        }
      }
    }
  `;

  const result: any = await getClient().request(mutation, {
    content: params.content,
    description: params.description || '',
    editor: 'markdown',
    isPublished: true,
    isPrivate: false,
    locale: 'en',
    path: params.path,
    tags: params.tags || [],
    title: params.title,
    scriptCss: params.scriptCss,
    scriptJs: params.scriptJs,
  });

  const response = result.pages.create;
  if (!response.responseResult.succeeded) {
    throw new Error(`Wiki.js error: ${response.responseResult.message}`);
  }

  logger.info({ path: params.path, id: response.page.id }, 'Created wiki page');
  return response.page;
}

export async function updatePage(
  id: number,
  content: string,
  title?: string,
  description?: string,
  tags?: string[],
  scriptCss?: string,
  scriptJs?: string
): Promise<WikiPage> {
  const mutation = `
    mutation UpdatePage(
      $id: Int!
      $content: String!
      $title: String
      $description: String!
      $tags: [String]!
      $scriptCss: String
      $scriptJs: String
    ) {
      pages {
        update(
          id: $id
          content: $content
          title: $title
          description: $description
          tags: $tags
          editor: "markdown"
          isPublished: true
          locale: "en"
          scriptCss: $scriptCss
          scriptJs: $scriptJs
        ) {
          responseResult { succeeded errorCode message }
          page { id path title }
        }
      }
    }
  `;

  const result: any = await getClient().request(mutation, {
    id,
    content,
    title,
    description: description || '',
    tags: tags || [],
    scriptCss,
    scriptJs,
  });
  const response = result.pages.update;
  if (!response.responseResult.succeeded) {
    throw new Error(`Wiki.js update error: ${response.responseResult.message}`);
  }
  return response.page;
}

export async function listPages(): Promise<WikiPage[]> {
  const query = `
    query {
      pages {
        list(orderBy: PATH) { id path title updatedAt }
      }
    }
  `;
  const result: any = await getClient().request(query);
  return result.pages.list;
}

export async function deletePage(id: number): Promise<void> {
  const mutation = `
    mutation DeletePage($id: Int!) {
      pages {
        delete(id: $id) {
          responseResult { succeeded message }
        }
      }
    }
  `;
  await getClient().request(mutation, { id });
}

export async function findPageByPath(pagePath: string): Promise<WikiPage | null> {
  const pages = await listPages();
  return pages.find((p) => p.path === pagePath) || null;
}

export async function upsertPage(params: {
  path: string;
  title: string;
  content: string;
  description?: string;
  tags?: string[];
  scriptCss?: string;
  scriptJs?: string;
}): Promise<WikiPage> {
  const existing = await findPageByPath(params.path);
  if (existing) {
    return updatePage(
      existing.id,
      params.content,
      params.title,
      params.description,
      params.tags,
      params.scriptCss,
      params.scriptJs
    );
  }
  return createPage(params);
}

export async function checkConnection(): Promise<boolean> {
  try {
    await listPages();
    return true;
  } catch {
    return false;
  }
}
