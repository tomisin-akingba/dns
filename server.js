import express from "express";
import fs from "fs";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 5000;

// Resolve paths relative to this file so the server behaves the same regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_PATH = path.join(__dirname, 'dns_records.txt');
const BUILD_DIR = path.join(__dirname, 'dist');

app.use(cors());
app.use(bodyParser.json());

// Serve built frontend if available (assumes you ran the frontend build into `dist`)
if (fs.existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR));
}

// Helper function to load records
const loadRecords = () => {
  if (!fs.existsSync(FILE_PATH)) return {};
  const data = fs.readFileSync(FILE_PATH, "utf8");
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};

// Helper to save records
const saveRecords = (records) => {
  fs.writeFileSync(FILE_PATH, JSON.stringify(records, null, 2), "utf8");
};

// 🟢 Get all records
app.get("/api/records", (req, res) => {
  const data = loadRecords();
  res.json(data);
});

// 🔵 Get a specific domain
app.get("/api/records/:domain", (req, res) => {
  const data = loadRecords();
  const domain = req.params.domain;
  res.json(data[domain] || {});
});

// 🟡 Save (Create/Update) domain records
app.post("/api/records/:domain", (req, res) => {
  const data = loadRecords();
  const domain = req.params.domain;
  data[domain] = req.body; // Replace or add new
  saveRecords(data);
  res.status(200).json({ message: "Saved successfully" });
});

// Accept PUT as well for updates (frontend may use PUT)
app.put("/api/records/:domain", (req, res) => {
  const data = loadRecords();
  const domain = req.params.domain;
  data[domain] = req.body; // Replace or add new
  saveRecords(data);
  res.status(200).json({ message: "Saved successfully" });
});

// 🔴 Delete a domain
app.delete("/api/records/:domain", (req, res) => {
  const data = loadRecords();
  const domain = req.params.domain;
  delete data[domain];
  saveRecords(data);
  res.json({ message: "Deleted successfully" });
});

// Fallback: serve index.html for any non-API GET request (SPA routing)
app.use((req, res) => {
  // Only handle GET requests
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  // don't intercept API routes
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  
  const indexPath = path.join(BUILD_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Not found');
});

app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);