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

// 1. Tjek om API nøglen er der
if (!process.env.NOTION_API_KEY) {
  console.error("FEJL: NOTION_API_KEY mangler i Railway Variables!");
}

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

// 2. Opret MCP Serveren
const server = new Server(
  { name: "notion-mcp-server", version: "1.0.1" },
  { capabilities: { tools: {} } }
);

// --- DEFINER TOOLS ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "notion_search",
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
        name: "notion_get_page",
        description: "Hent indholdet (blokke) fra en side",
        inputSchema: {
          type: "object",
          properties: {
            block_id: { type: "string", description: "ID på siden eller blokken" },
          },
          required: ["block_id"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "notion_search") {
        const results = await notion.search({ query: String(args?.query), page_size: 5 });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    if (name === "notion_get_page") {
        const response = await notion.blocks.children.list({ block_id: String(args?.block_id) });
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    throw new Error(`Ukendt værktøj: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Fejl: ${error.message}` }], isError: true };
  }
});

// --- SERVER SETUP ---
const app = express();
app.use(cors());

// Vigtigt: Root GET så vi kan tjekke om serveren lever i en browser
app.get("/", (req, res) => {
    res.send("Notion MCP Server kører! Brug /mcp endpointet i n8n.");
});

// Gemmer aktive forbindelser
const transports = new Map<string, SSEServerTransport>();

// 1. n8n kalder denne først (GET) for at åbne strømmen
app.get("/mcp", async (req, res) => {
  console.log("Opretter ny SSE forbindelse...");
  const transport = new SSEServerTransport("/mcp", res);
  
  // Gem transporten i vores map (vi bruger en simpel nøgle her for n8n)
  transports.set("n8n-session", transport);
  
  await server.connect(transport);
  
  req.on("close", () => {
    console.log("Forbindelse lukket.");
    transports.delete("n8n-session");
  });
});

// 2. n8n sender beskeder her (POST)
app.post("/mcp", express.json(), async (req, res) => {
  const transport = transports.get("n8n-session");
  
  if (!transport) {
    console.warn("Modtog POST men ingen GET forbindelse endnu. Prøver at vente 500ms...");
    // Giv den lige en chance hvis n8n er for hurtig
    setTimeout(async () => {
        const retryTransport = transports.get("n8n-session");
        if (retryTransport) {
            await retryTransport.handlePostMessage(req, res);
        } else {
            res.status(500).send("Ingen aktiv session. Prøv at køre n8n noden igen.");
        }
    }, 500);
    return;
  }

  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server kører på port ${PORT}`);
});