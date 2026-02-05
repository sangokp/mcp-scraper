# @aegis-ai/mcp-scraper

MCP server for intelligent web scraping. Supports static pages, JavaScript-rendered SPAs (via Playwright), and natural language data extraction.

## Install

```bash
# Add to Claude Desktop config (~/.claude/claude_desktop_config.json):
{
  "mcpServers": {
    "scraper": {
      "command": "bunx",
      "args": ["@aegis-ai/mcp-scraper"]
    }
  }
}

# Or run directly:
bunx @aegis-ai/mcp-scraper
```

## Tools

### scrape

Fetch a web page and return clean text content.

```json
{
  "url": "https://news.ycombinator.com",
  "js": false,
  "selector": ".titleline",
  "headers": { "Cookie": "session=abc" }
}
```

### extract

Scrape a page and extract structured data using natural language.

```json
{
  "url": "https://example.com/products",
  "prompt": "Get all product names, prices, and ratings",
  "js": true
}
```

### batch_scrape

Scrape multiple URLs with rate limiting (1s between requests).

```json
{
  "urls": ["https://example.com/page1", "https://example.com/page2"],
  "js": false
}
```

## Features

- Static page fetching (fast, no browser needed)
- JavaScript rendering via Playwright (for SPAs)
- CSS selector targeting
- Custom headers support
- Automatic HTML stripping
- Content truncation to avoid context overflow
- Rate-limited batch scraping

## License

MIT - AEGIS AI Cooperative
