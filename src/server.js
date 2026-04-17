const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Config persistence
const configPath = path.join(__dirname, '../config.json');

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveConfig() {
  const data = {
    aiProvider: botState.aiProvider,
    botContext: botState.botContext,
    botEnabled: botState.botEnabled,
    selectedTables: botState.selectedTables,
    dbConnected: botState.dbConnected,
    dbType: botState.dbType,
    ollamaUrl: process.env.OLLAMA_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY
  };
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

const savedConfig = loadConfig();

// State
let botState = {
  connected: false,
  status: 'DISCONNECTED',
  phoneNumber: null,
  messagesHandled: 0,
  activeChats: new Set(),
  dbConnected: savedConfig.dbConnected || false,
  dbType: savedConfig.dbType || null,
  dbTables: [],
  selectedTables: savedConfig.selectedTables || [],
  aiProvider: savedConfig.aiProvider || 'none', // 'anthropic' | 'ollama' | 'openai' | 'gemini' | 'none'
  botEnabled: savedConfig.botEnabled !== undefined ? savedConfig.botEnabled : true,
  logs: [],
  qrCode: null,
  instantReplies: loadReplies(),
  botContext: savedConfig.botContext || `Eres un asistente de WhatsApp amigable y profesional. 
Responde de forma concisa.`,
};

// Initialize env from config if present
if (savedConfig.openaiApiKey) process.env.OPENAI_API_KEY = savedConfig.openaiApiKey;
if (savedConfig.geminiApiKey) process.env.GEMINI_API_KEY = savedConfig.geminiApiKey;
if (savedConfig.anthropicApiKey) process.env.ANTHROPIC_API_KEY = savedConfig.anthropicApiKey;
if (savedConfig.ollamaUrl) process.env.OLLAMA_URL = savedConfig.ollamaUrl;
if (savedConfig.ollamaModel) process.env.OLLAMA_MODEL = savedConfig.ollamaModel;

function loadReplies() {
  const filePath = path.join(__dirname, '../replies.json');
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveReplies() {
  const filePath = path.join(__dirname, '../replies.json');
  fs.writeFileSync(filePath, JSON.stringify(botState.instantReplies, null, 2));
}

let whatsappClient = null;
let dbConnection = null;
let tableSchema = {};

// ─── LOGGING ────────────────────────────────────────────────────────────────
function log(level, message, data = null) {
  const entry = {
    id: Date.now() + Math.random(),
    ts: new Date().toISOString(),
    level,
    message,
    data,
  };
  botState.logs.unshift(entry);
  if (botState.logs.length > 200) botState.logs = botState.logs.slice(0, 200);
  io.emit('log', entry);
  console.log(`[${level}] ${message}`, data || '');
}

function emitState() {
  io.emit('state', { ...botState, activeChats: botState.activeChats.size });
}

// ─── WHATSAPP ────────────────────────────────────────────────────────────────
async function initWhatsApp() {
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode');

    log('INFO', 'Initializing WhatsApp client...');
    botState.status = 'INITIALIZING';
    io.emit('state', botState);

    whatsappClient = new Client({
      authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '../sessions') }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    whatsappClient.on('qr', async (qr) => {
      log('INFO', 'QR Code generated - scan with WhatsApp');
      botState.status = 'QR_READY';
      try {
        botState.qrCode = await qrcode.toDataURL(qr);
      } catch (e) {
        botState.qrCode = qr;
      }
      io.emit('state', botState);
    });

    whatsappClient.on('authenticated', () => {
      log('SUCCESS', 'WhatsApp authenticated');
      botState.status = 'AUTHENTICATED';
      botState.qrCode = null;
      io.emit('state', botState);
    });

    whatsappClient.on('ready', () => {
      log('SUCCESS', 'WhatsApp ready and connected!');
      botState.connected = true;
      botState.status = 'CONNECTED';
      botState.phoneNumber = whatsappClient.info?.wid?.user || 'Unknown';
      io.emit('state', botState);
    });

    whatsappClient.on('disconnected', (reason) => {
      log('WARN', `WhatsApp disconnected: ${reason}`);
      botState.connected = false;
      botState.status = 'DISCONNECTED';
      io.emit('state', botState);
    });

    whatsappClient.on('message', async (msg) => {
      if (msg.fromMe || msg.from === 'status@broadcast') return;
      if (!botState.botEnabled) return;

      const contact = await msg.getContact();
      const name = contact.pushname || contact.name || msg.from;
      botState.messagesHandled++;
      botState.activeChats.add(msg.from);

      log('MESSAGE', `From ${name}: ${msg.body}`);
      io.emit('message', {
        from: name,
        number: msg.from,
        body: msg.body,
        ts: new Date().toISOString(),
      });
      io.emit('state', { ...botState, activeChats: botState.activeChats.size });

      try {
        const { reply, media } = await processMessage(msg.body, name);
        if (reply || media) {
          if (media) {
            await whatsappClient.sendMessage(msg.from, media, { caption: reply || '' });
          } else {
            await msg.reply(reply);
          }
          log('SUCCESS', `Replied to ${name}${media ? ' with media' : ''}: ${reply ? reply.substring(0, 60) + '...' : ''}`);
          io.emit('reply', { to: name, body: reply || '[Media]', ts: new Date().toISOString() });
        }
      } catch (err) {
        log('ERROR', `Failed to process message: ${err.message}`);
      }
    });

    await whatsappClient.initialize();
  } catch (err) {
    log('ERROR', `WhatsApp init failed: ${err.message}`);
    botState.status = 'ERROR';
    io.emit('state', botState);
  }
}

// ─── MESSAGE PROCESSOR ──────────────────────────────────────────────────────
async function processMessage(text, senderName) {
  const lower = text.toLowerCase().trim();
  const { MessageMedia } = require('whatsapp-web.js');

  // Instant replies logic
  for (const r of botState.instantReplies) {
    const keywords = r.keyword.split(',').map(k => k.toLowerCase().trim());
    const isMatch = keywords.some(k => lower === k || lower.includes(` ${k} `) || lower.startsWith(`${k} `) || lower.endsWith(` ${k}`));

    if (isMatch) {
      const responseText = r.response ? r.response.replace(/{name}/g, senderName) : null;
      let media = null;
      if (r.imageUrl) {
        try {
          media = await MessageMedia.fromUrl(r.imageUrl);
        } catch (e) {
          log('ERROR', `Failed to load media from URL: ${r.imageUrl}`);
        }
      }
      return { reply: responseText, media };
    }
  }

  // DB query detection
  if (botState.dbConnected && botState.selectedTables.length > 0) {
    const dbResult = await tryDatabaseQuery(lower, text);
    if (dbResult) return { reply: dbResult };
  }

  // AI response
  try {
    let aiReply = null;
    if (botState.aiProvider === 'anthropic') {
      aiReply = await callAnthropic(text, senderName);
    } else if (botState.aiProvider === 'ollama') {
      aiReply = await callOllama(text, senderName);
    } else if (botState.aiProvider === 'openai') {
      aiReply = await callOpenAI(text, senderName);
    } else if (botState.aiProvider === 'gemini') {
      aiReply = await callGemini(text, senderName);
    }
    if (aiReply) return { reply: aiReply };
  } catch (err) {
    // If AI fails but it was the intended provider, we log it but move to fallback
    log('ERROR', `AI Provider (${botState.aiProvider}) failed: ${err.message}`);
  }

  // Fallback if nothing matched and AI failed/none
  if (botState.botEnabled) {
    return { reply: `¡Hola ${senderName}! 👋 Gracias por escribir. En este momento estoy procesando tu solicitud. ¿En qué más puedo ayudarte?` };
  }
  return { reply: null };
}

// ─── DATABASE QUERY ──────────────────────────────────────────────────────────
async function tryDatabaseQuery(lower, original) {
  const keywords = ['precio', 'stock', 'producto', 'cuanto', 'costo', 'disponible', 'hay', 'buscar', 'price', 'product', 'inventory'];
  const hasKeyword = keywords.some(k => lower.includes(k));
  if (!hasKeyword) return null;

  // Extract search term
  const stopwords = ['precio', 'stock', 'del', 'de', 'el', 'la', 'los', 'las', 'cuanto', 'cuesta', 'hay', 'buscar', 'quiero', 'saber', 'me', 'puedes', 'decir', 'dame', 'info', 'sobre', 'product', 'price', 'what', 'is', 'the', 'of'];
  const words = lower.split(/\s+/).filter(w => w.length > 2 && !stopwords.includes(w));
  const searchTerm = words.join(' ').trim();

  if (!searchTerm) return null;

  try {
    const results = await searchInDatabase(searchTerm);
    if (results && results.length > 0) {
      return formatDbResults(results, searchTerm);
    } else {
      return `🔍 No encontré resultados para *"${searchTerm}"* en la base de datos.`;
    }
  } catch (err) {
    log('ERROR', `DB query error: ${err.message}`);
    return null;
  }
}

async function searchInDatabase(term) {
  if (!dbConnection) return null;
  const results = [];

  for (const table of botState.selectedTables) {
    const schema = tableSchema[table];
    if (!schema) continue;

    const cols = schema.columns;
    const textCols = cols.filter(c => ['varchar', 'text', 'char', 'string', 'name', 'description', 'nombre'].some(t => c.type?.toLowerCase().includes(t) || c.name?.toLowerCase().includes('name') || c.name?.toLowerCase().includes('nombre') || c.name?.toLowerCase().includes('desc')));
    const numCols = cols.filter(c => ['int', 'float', 'decimal', 'double', 'numeric', 'number', 'price', 'precio', 'stock', 'cantidad'].some(t => c.type?.toLowerCase().includes(t) || c.name?.toLowerCase().includes('price') || c.name?.toLowerCase().includes('precio') || c.name?.toLowerCase().includes('stock') || c.name?.toLowerCase().includes('cantidad')));

    if (textCols.length === 0) continue;

    const conditions = textCols.map(c => `LOWER(CAST(\`${c.name}\` AS CHAR)) LIKE ?`).join(' OR ');
    const params = textCols.map(() => `%${term.toLowerCase()}%`);

    try {
      let rows;
      if (botState.dbType === 'mysql') {
        const sql = `SELECT * FROM \`${table}\` WHERE ${conditions} LIMIT 5`;
        [rows] = await dbConnection.execute(sql, params);
      } else if (botState.dbType === 'postgres') {
        const pgConditions = textCols.map((c, i) => `LOWER(CAST("${c.name}" AS TEXT)) LIKE $${i + 1}`).join(' OR ');
        const sql = `SELECT * FROM "${table}" WHERE ${pgConditions} LIMIT 5`;
        const res = await dbConnection.query(sql, params);
        rows = res.rows;
      }
      if (rows && rows.length > 0) {
        results.push({ table, rows, textCols, numCols });
      }
    } catch (e) {
      log('WARN', `Query on ${table} failed: ${e.message}`);
    }
  }
  return results;
}

function formatDbResults(results, term) {
  let response = `🔍 *Resultados para "${term}":*\n\n`;
  let count = 0;

  for (const { table, rows, numCols } of results) {
    for (const row of rows) {
      count++;
      response += `━━━━━━━━━━━━━━\n`;
      const keys = Object.keys(row);
      for (const key of keys) {
        const val = row[key];
        if (val === null || val === undefined) continue;
        const lk = key.toLowerCase();
        let icon = '•';
        if (lk.includes('name') || lk.includes('nombre') || lk.includes('producto')) icon = '📦';
        else if (lk.includes('price') || lk.includes('precio') || lk.includes('costo')) icon = '💰';
        else if (lk.includes('stock') || lk.includes('cantidad') || lk.includes('qty')) icon = '📊';
        else if (lk.includes('desc')) icon = '📝';
        response += `${icon} *${key}:* ${val}\n`;
      }
    }
  }

  if (count === 0) return `🔍 No encontré resultados para *"${term}"*.`;
  response += `━━━━━━━━━━━━━━\n_${count} resultado(s) encontrado(s)_`;
  return response;
}

// ─── AI PROVIDERS ─────────────────────────────────────────────────────────────
async function callAnthropic(text, name) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key configured');

  const axios = require('axios');
  const sysPrompt = buildSystemPrompt();

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: sysPrompt,
    messages: [{ role: 'user', content: `${name}: ${text}` }],
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  });

  return res.data.content[0].text;
}

async function callOllama(text, name) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';
  const axios = require('axios');

  const res = await axios.post(`${ollamaUrl}/api/generate`, {
    model: ollamaModel,
    prompt: `${buildSystemPrompt()}\n\nUsuario (${name}): ${text}\nAsistente:`,
    stream: false,
  });

  return res.data.response?.trim();
}

async function callOpenAI(text, name) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('No OpenAI API key configured');

  const axios = require('axios');
  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini', // Lightweight and cheaper
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: `${name}: ${text}` }
    ],
    max_tokens: 500
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  return res.data.choices[0].message.content.trim();
}

async function callGemini(text, name) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('No Gemini API key configured');

  const axios = require('axios');
  // Using Gemini 1.5 Flash (free tier often available)
  const res = await axios.post(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    contents: [
      {
        role: 'user',
        parts: [{ text: `SYSTEM INSTRUCTIONS: ${buildSystemPrompt()}\n\nUser (${name}): ${text}` }]
      }
    ]
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  return res.data.candidates[0].content.parts[0].text.trim();
}

function buildSystemPrompt() {
  const context = botState.botContext || 'Eres un asistente de WhatsApp amigable y profesional.';
  return `${context} 
Responde de forma concisa (máximo 2-3 párrafos). Usa emojis ocasionalmente. Eres útil, claro y directo. 
Si el usuario pregunta por precios o productos y no tienes la información, invítalo a esperar a un humano. 
Responde siempre en el mismo idioma que el usuario.`;
}

// ─── DATABASE CONNECTION ──────────────────────────────────────────────────────
async function connectDatabase(config) {
  const { type, host, port, user, password, database } = config;
  try {
    if (type === 'mysql') {
      const mysql = require('mysql2/promise');
      dbConnection = await mysql.createConnection({ host, port: port || 3306, user, password, database });
      botState.dbType = 'mysql';
    } else if (type === 'postgres') {
      const { Client } = require('pg');
      dbConnection = new Client({ host, port: port || 5432, user, password, database });
      await dbConnection.connect();
      botState.dbType = 'postgres';
    }

    botState.dbConnected = true;
    const tables = await fetchTables();
    botState.dbTables = tables;
    log('SUCCESS', `Database connected: ${type} → ${database} (${tables.length} tables)`);
    emitState();
    return { success: true, tables };
  } catch (err) {
    log('ERROR', `DB connection failed: ${err.message}`);
    throw err;
  }
}

async function fetchTables() {
  if (!dbConnection) return [];
  if (botState.dbType === 'mysql') {
    const [rows] = await dbConnection.execute('SHOW TABLES');
    return rows.map(r => Object.values(r)[0]);
  } else if (botState.dbType === 'postgres') {
    const res = await dbConnection.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    return res.rows.map(r => r.tablename);
  }
  return [];
}

async function loadTableSchema(table) {
  if (tableSchema[table]) return tableSchema[table];
  try {
    let cols = [];
    if (botState.dbType === 'mysql') {
      const [rows] = await dbConnection.execute(`DESCRIBE \`${table}\``);
      cols = rows.map(r => ({ name: r.Field, type: r.Type }));
    } else if (botState.dbType === 'postgres') {
      const res = await dbConnection.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1`, [table]);
      cols = res.rows.map(r => ({ name: r.column_name, type: r.data_type }));
    }
    tableSchema[table] = { columns: cols };
    return tableSchema[table];
  } catch (e) {
    log('WARN', `Schema load failed for ${table}: ${e.message}`);
    return { columns: [] };
  }
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json({ ...botState, activeChats: botState.activeChats.size });
});

app.post('/api/whatsapp/connect', async (req, res) => {
  if (whatsappClient) {
    return res.json({ error: 'Already connected or connecting' });
  }
  initWhatsApp();
  res.json({ success: true, message: 'WhatsApp initialization started' });
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  if (whatsappClient) {
    await whatsappClient.destroy();
    whatsappClient = null;
  }
  botState.connected = false;
  botState.status = 'DISCONNECTED';
  botState.qrCode = null;
  emitState();
  log('INFO', 'WhatsApp disconnected manually');
  res.json({ success: true });
});

app.post('/api/whatsapp/toggle-bot', (req, res) => {
  botState.botEnabled = !botState.botEnabled;
  log('INFO', `Bot ${botState.botEnabled ? 'ENABLED' : 'DISABLED'}`);
  saveConfig();
  emitState();
  res.json({ enabled: botState.botEnabled });
});

app.post('/api/ai/config', (req, res) => {
  const { provider, apiKey, ollamaUrl, ollamaModel, botContext, openaiKey, geminiKey } = req.body;

  if (provider) botState.aiProvider = provider;
  if (botContext !== undefined) botState.botContext = botContext;

  if (provider === 'anthropic' && apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
  if (provider === 'openai' && openaiKey) process.env.OPENAI_API_KEY = openaiKey;
  if (provider === 'gemini' && geminiKey) process.env.GEMINI_API_KEY = geminiKey;

  if (ollamaUrl) process.env.OLLAMA_URL = ollamaUrl;
  if (ollamaModel) process.env.OLLAMA_MODEL = ollamaModel;

  saveConfig();
  log('INFO', `Updated intelligence config and persisted to config.json`);
  emitState();
  res.json({ success: true });
});

app.post('/api/ai/test', async (req, res) => {
  const { text, name } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  log('INFO', `Running AI Simulation for "${name}": ${text}`);
  try {
    const result = await processMessage(text, name || 'Tester');
    res.json({ ...result, ts: new Date().toISOString() });
  } catch (err) {
    log('ERROR', `Simulation failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db/connect', async (req, res) => {
  try {
    const result = await connectDatabase(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db/disconnect', async (req, res) => {
  if (dbConnection) {
    try {
      if (botState.dbType === 'mysql') await dbConnection.end();
      else if (botState.dbType === 'postgres') await dbConnection.end();
    } catch (e) { }
    dbConnection = null;
  }
  botState.dbConnected = false;
  botState.dbTables = [];
  botState.selectedTables = [];
  tableSchema = {};
  log('INFO', 'Database disconnected');
  io.emit('state', botState);
  res.json({ success: true });
});

app.post('/api/db/tables/select', async (req, res) => {
  const { tables } = req.body;
  botState.selectedTables = tables;
  for (const t of tables) await loadTableSchema(t);
  saveConfig();
  log('INFO', `Selected tables: ${tables.join(', ')}`);
  emitState();
  res.json({ success: true, schemas: tableSchema });
});

app.post('/api/db/query', async (req, res) => {
  const { term } = req.body;
  try {
    const results = await searchInDatabase(term);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { number, message } = req.body;
  if (!whatsappClient || !botState.connected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await whatsappClient.sendMessage(chatId, message);
    log('SUCCESS', `Manual message sent to ${number}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/replies/add', (req, res) => {
  const { keyword, response, imageUrl } = req.body;
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });
  const id = Date.now().toString();
  botState.instantReplies.push({ id, keyword, response, imageUrl });
  saveReplies();
  log('INFO', `Added instant reply for: "${keyword}"`);
  emitState();
  res.json({ success: true, id });
});

app.post('/api/replies/delete', (req, res) => {
  const { id } = req.body;
  botState.instantReplies = botState.instantReplies.filter(r => r.id !== id);
  saveReplies(); // Persist
  log('INFO', `Removed instant reply`);
  emitState();
  res.json({ success: true });
});

// Serve index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── SOCKET ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('state', { ...botState, activeChats: botState.activeChats.size });
  socket.emit('logs', botState.logs);
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('SUCCESS', `🚀 WhatsApp Bot Dashboard running on http://localhost:${PORT}`);
});
