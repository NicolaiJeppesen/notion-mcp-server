#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";
import express from "express";
import cors from "cors";

// 1. Konfigurer Notion Client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const TOOLS = {
  SEARCH: "notion_search",
  APPEND_BLOCK: "notion_append_block",
  GET_PAGE: "notion_get_page",
};

// 2. Opret MCP Serveren
const server = new Server(
  {
    name: "notion-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 3. Definer Værktøjerne (Tools)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: TOOLS.SEARCH,
        description: "Søg efter sider eller databaser i Notion",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Tekst du vil søge efter" },
          },
          required: ["query"],
        },
      },
      {
        name: TOOLS.GET_PAGE,
        description: "Hent indholdet (blokke) fra en side",
        inputSchema: {
          type: "object",
          properties: {
            block_id: { type: "string", description: "ID på siden eller blokken" },
          },
          required: ["block_id"],
        },
      },
      {
        name: TOOLS.APPEND_BLOCK,
        description: "Tilføj indhold til bunden af en side",
        inputSchema: {
          type: "object",
          properties: {
            block_id: { type: "string", description: "ID på siden du vil skrive på" },
            content: { type: "string", description: "Teksten der skal indsættes" },
          },
          required: ["block_id", "content"],
        },
      },
    ],
  };
});

// 4. Håndter Værktøjs-kald
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`Udfører værktøj: ${name}`); // Log hvilke værktøjer der kaldes

  try {
    switch (name) {
      case TOOLS.SEARCH: {
        const query = String(args?.query);
        const results = await notion.search({
          query,
          page_size: 5,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }
      case TOOLS.GET_PAGE: {
        const blockId = String(args?.block_id);
        const response = await notion.blocks.children.list({
          block_id: blockId,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
      case TOOLS.APPEND_BLOCK: {
        const blockId = String(args?.block_id);
        const content = String(args?.content);
        
        const response = await notion.blocks.children.append({
          block_id: blockId,
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content } }],
              },
            },
          ],
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
      default:
        throw new Error(`Ukendt værktøj: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Fejl i værktøj ${name}:`, errorMessage);
    return {
      content: [{ type: "text", text: `Fejl: ${errorMessage}` }],
      isError: true,
    };
  }
});

// 5. Start Express Webserveren (SSE)
const app = express();
app.use(cors());
app.use(express.json()); // VIGTIGT: Tillad JSON parsing

// LOG ALLE REQUESTS (Så vi kan se hvad n8n gør)
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

// Health check til Railway
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

let transport: SSEServerTransport | null = null;

// Håndter SSE forbindelse (GET) - n8n skal ramme denne FØRST
app.get("/sse", async (req, res) => {
  console.log("Ny SSE forbindelse starter...");
  
  transport = new SSEServerTransport("/sse", res);
  await server.connect(transport);
  
  console.log("SSE forbindelse etableret!");
});

// Håndter beskeder (POST)
app.post("/sse", async (req, res) => {
  if (!transport) {
    console.error("FEJL: Modtog POST men ingen transport er aktiv. (Mangler GET kald først?)");
    res.status(500).send("Ingen aktiv SSE forbindelse fundet. Genstart n8n noden.");
    return;
  }
  
  console.log("Håndterer besked via eksisterende transport");
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Notion MCP Server kører på port ${PORT}`);
});