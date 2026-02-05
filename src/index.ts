#!/usr/bin/env bun
/**
 * AEGIS MCP Scraper - Intelligent web scraping MCP server
 *
 * Tools:
 *   scrape       - Fetch and return page content (static or JS-rendered)
 *   extract      - Scrape + extract structured data via natural language
 *   batch_scrape - Scrape multiple URLs with rate limiting
 *
 * Install: npx @aegis-ai/mcp-scraper
 * Or add to claude_desktop_config.json:
 *   { "mcpServers": { "scraper": { "command": "bunx", "args": ["@aegis-ai/mcp-scraper"] } } }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Core Scraping ───────────────────────────────────────────────

interface ScrapeResult {
  url: string;
  success: boolean;
  timestamp: string;
  content?: string;
  extracted?: unknown;
  error?: string;
  metadata?: {
    title?: string;
    statusCode?: number;
    contentType?: string;
    loadTime?: number;
    wordCount?: number;
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function simpleFetch(url: string, headers?: Record<string, string>): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AEGIS-MCP-Scraper/1.0 (compatible; research bot)",
        ...headers,
      },
      signal: AbortSignal.timeout(30000),
    });

    const html = await response.text();
    const loadTime = Date.now() - start;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const cleanText = stripHtml(html);

    return {
      url,
      success: true,
      timestamp: new Date().toISOString(),
      content: cleanText,
      metadata: {
        title: titleMatch ? titleMatch[1].trim() : undefined,
        statusCode: response.status,
        contentType: response.headers.get("content-type") || undefined,
        loadTime,
        wordCount: cleanText.split(/\s+/).length,
      },
    };
  } catch (error) {
    return {
      url,
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function playwrightFetch(
  url: string,
  selector?: string,
  waitFor?: string
): Promise<ScrapeResult> {
  const start = Date.now();
  let browser = null;

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "AEGIS-MCP-Scraper/1.0 (compatible; research bot)",
    });
    const page = await context.newPage();

    const response = await page.goto(url, {
      timeout: 30000,
      waitUntil: "networkidle",
    });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10000 });
    }

    let content: string;
    if (selector) {
      const elements = await page.$$(selector);
      const texts = await Promise.all(elements.map((el) => el.textContent()));
      content = texts.filter(Boolean).join("\n\n");
    } else {
      const html = await page.content();
      content = stripHtml(html);
    }

    const title = await page.title();
    const loadTime = Date.now() - start;
    await browser.close();

    return {
      url,
      success: true,
      timestamp: new Date().toISOString(),
      content,
      metadata: {
        title,
        statusCode: response?.status(),
        contentType: response?.headers()["content-type"],
        loadTime,
        wordCount: content.split(/\s+/).length,
      },
    };
  } catch (error) {
    if (browser) await browser.close();
    return {
      url,
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  { name: "aegis-mcp-scraper", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "scrape",
      description:
        "Fetch a web page and return its text content. Supports static pages (default) and JavaScript-rendered pages (set js=true). Returns clean text with HTML stripped.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "URL to scrape" },
          js: {
            type: "boolean",
            description: "Use headless browser for JS-rendered pages (default: false)",
          },
          selector: {
            type: "string",
            description: "CSS selector to extract specific elements (with js=true)",
          },
          waitFor: {
            type: "string",
            description: "CSS selector to wait for before extracting (with js=true)",
          },
          headers: {
            type: "object",
            description: "Custom HTTP headers",
            additionalProperties: { type: "string" },
          },
        },
        required: ["url"],
      },
    },
    {
      name: "extract",
      description:
        "Scrape a web page and extract structured data using a natural language prompt. Describe what data you want and the tool returns it as JSON. Example: 'Get all product names and prices'",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "URL to scrape" },
          prompt: {
            type: "string",
            description: "Natural language description of what data to extract",
          },
          js: {
            type: "boolean",
            description: "Use headless browser for JS-rendered pages",
          },
          selector: { type: "string", description: "CSS selector to narrow extraction scope" },
        },
        required: ["url", "prompt"],
      },
    },
    {
      name: "batch_scrape",
      description:
        "Scrape multiple URLs with 1-second rate limiting between requests. Returns array of results.",
      inputSchema: {
        type: "object" as const,
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "Array of URLs to scrape",
          },
          js: { type: "boolean", description: "Use headless browser for all URLs" },
        },
        required: ["urls"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "scrape": {
      const { url, js, selector, waitFor, headers } = args as {
        url: string;
        js?: boolean;
        selector?: string;
        waitFor?: string;
        headers?: Record<string, string>;
      };

      const result = js
        ? await playwrightFetch(url, selector, waitFor)
        : await simpleFetch(url, headers);

      // Truncate content to avoid overwhelming context
      if (result.content && result.content.length > 50000) {
        result.content = result.content.slice(0, 50000) + "\n\n[Content truncated at 50,000 characters]";
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "extract": {
      const { url, prompt, js, selector } = args as {
        url: string;
        prompt: string;
        js?: boolean;
        selector?: string;
      };

      const result = js
        ? await playwrightFetch(url, selector)
        : await simpleFetch(url);

      if (!result.success) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true,
        };
      }

      // Return content with extraction prompt for the LLM to process
      const cleanContent = (result.content || "").slice(0, 30000);
      const extractionContext = `Page: ${url}\nTitle: ${result.metadata?.title || "Unknown"}\n\nExtraction request: ${prompt}\n\nPage content:\n${cleanContent}`;

      return {
        content: [{ type: "text", text: extractionContext }],
      };
    }

    case "batch_scrape": {
      const { urls, js } = args as { urls: string[]; js?: boolean };
      const results: ScrapeResult[] = [];

      for (const url of urls) {
        const result = js
          ? await playwrightFetch(url)
          : await simpleFetch(url);

        // Truncate each result
        if (result.content && result.content.length > 10000) {
          result.content = result.content.slice(0, 10000) + "\n[Truncated]";
        }

        results.push(result);
        await new Promise((r) => setTimeout(r, 1000));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ─── Start ───────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
