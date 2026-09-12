import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface Article {
  id: string;
  title: string;
  // No onlineStoreUrl on Article either (verified live) — callers build
  // /blogs/{blogHandle}/{articleHandle} themselves.
  handle: string;
  updatedAt: string;
}

export interface Blog {
  id: string;
  title: string;
  handle: string;
  articles: Article[];
}

const BLOGS_WITH_ARTICLES_QUERY = `#graphql
  query BlogsWithArticles($first: Int!, $articlesFirst: Int!) {
    blogs(first: $first) {
      edges {
        node {
          id
          title
          handle
          articles(first: $articlesFirst) {
            edges {
              node {
                id
                title
                handle
                updatedAt
              }
            }
          }
        }
      }
    }
  }
`;

interface BlogsResponse {
  blogs: {
    edges: {
      node: {
        id: string;
        title: string;
        handle: string;
        articles: { edges: { node: Article }[] };
      };
    }[];
  };
}

export const BlogService = {
  /**
   * All blogs (up to `first`) with their articles (up to `articlesFirst`
   * each). One request either way — not cursor-paginated per blog, since a
   * shop with more than a handful of blogs or a blog with hundreds of
   * posts is rare; revisit if that assumption breaks.
   */
  async listBlogsWithArticles(
    session: Session,
    options: { first?: number; articlesFirst?: number } = {},
  ): Promise<Blog[]> {
    const data = await runAdminQuery<BlogsResponse>(
      session,
      BLOGS_WITH_ARTICLES_QUERY,
      { first: options.first ?? 25, articlesFirst: options.articlesFirst ?? 50 },
    );

    return data.blogs.edges.map((blogEdge) => ({
      id: blogEdge.node.id,
      title: blogEdge.node.title,
      handle: blogEdge.node.handle,
      articles: blogEdge.node.articles.edges.map((articleEdge) => articleEdge.node),
    }));
  },
};
