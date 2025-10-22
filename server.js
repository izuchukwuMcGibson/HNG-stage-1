import 'dotenv/config'; 
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Simple CORS for testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------------- Helpers ----------------
function calculateHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function isPalindrome(value) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
}
function countUniqueCharacters(value) {
  return new Set(value).size;
}
function countWords(value) {
  return value.trim().split(/\s+/).filter(w => w.length > 0).length;
}
function createCharacterFrequencyMap(value) {
  const frequencyMap = {};
  for (const char of value) {
    frequencyMap[char] = (frequencyMap[char] || 0) + 1;
  }
  return frequencyMap;
}
function computeStringProperties(value) {
  return {
    length: value.length,
    is_palindrome: isPalindrome(value),
    unique_characters: countUniqueCharacters(value),
    word_count: countWords(value),
    sha256_hash: calculateHash(value),
    character_frequency_map: createCharacterFrequencyMap(value)
  };
}

// ---------------- Persistence Abstraction ----------------
let useInMemory = true;
let StringModel = null;
const inMemoryStore = new Map();

function mapDocToResponse(doc) {
  return {
    id: doc._id ?? doc.id,
    value: doc.value,
    properties: doc.properties,
    created_at: doc.created_at
  };
}

async function memInsert(doc) {
  inMemoryStore.set(doc._id, doc);
  return doc;
}
async function memFind(query = {}) {
  const results = [];
  const regexValue = query.value && query.value.$regex ? new RegExp(query.value.$regex, query.value.$options || '') : null;
  for (const v of inMemoryStore.values()) {
    let ok = true;
    if (query['properties.is_palindrome'] !== undefined) ok = ok && v.properties.is_palindrome === query['properties.is_palindrome'];
    if (query['properties.word_count'] !== undefined) ok = ok && v.properties.word_count === query['properties.word_count'];
    if (query['properties.length'] && query['properties.length'].$gte !== undefined) ok = ok && v.properties.length >= query['properties.length'].$gte;
    if (query['properties.length'] && query['properties.length'].$lte !== undefined) ok = ok && v.properties.length <= query['properties.length'].$lte;
    if (regexValue) ok = ok && regexValue.test(v.value);
    if (ok) results.push(v);
  }
  return results;
}
async function memFindOne(id) {
  return inMemoryStore.get(id) || null;
}
async function memDeleteOne(id) {
  const existed = inMemoryStore.delete(id);
  return { deletedCount: existed ? 1 : 0 };
}
async function memCount() {
  return inMemoryStore.size;
}

const stringSchema = new mongoose.Schema({
  _id: { type: String },
  value: { type: String, required: true },
  properties: { type: Object, required: true },
  created_at: { type: Date, default: () => new Date().toISOString() }
}, { versionKey: false });

let db = {
  insert: memInsert,
  find: async (q) => memFind(q),
  findOneById: memFindOne,
  deleteOneById: memDeleteOne,
  count: memCount
};

async function tryConnectMongoose() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.log('No MONGODB_URI found in environment — using in-memory store');
    return;
  }

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI);
    StringModel = mongoose.model('String', stringSchema);
    useInMemory = false;
    db.insert = async (doc) => {
      const created = await StringModel.create(doc);
      return created.toObject ? created.toObject() : created;
    };
    db.find = async (query) => {
      const docs = await StringModel.find(query).lean().exec();
      return docs;
    };
    db.findOneById = async (id) => {
      const doc = await StringModel.findById(id).lean().exec();
      return doc;
    };
    db.deleteOneById = async (id) => {
      const res = await StringModel.deleteOne({ _id: id });
      return { deletedCount: res.deletedCount ?? res.n ?? 0 };
    };
    db.count = async () => {
      return await StringModel.countDocuments();
    };
    console.log('🔌 Connected to MongoDB via mongoose');
  } catch (err) {
    console.error('Could not connect to MongoDB, falling back to in-memory store. Error:', err.message);
    useInMemory = true;
  }
}

// ---------------- Routes (same as before) ----------------
// Health
app.get('/health', async (req, res) => {
  try {
    const count = await db.count();
    res.json({ status: 'ok', storage_count: count, using_in_memory: useInMemory });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /strings
app.post('/strings', async (req, res) => {
  try {
    if (!req.body || !('value' in req.body)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "value" field' });
    }
    const { value } = req.body;
    if (typeof value !== 'string') {
      return res.status(422).json({ error: 'Unprocessable Entity', message: '"value" must be a string' });
    }
    const properties = computeStringProperties(value);
    const id = properties.sha256_hash;
    const doc = { _id: id, value, properties, created_at: new Date().toISOString() };
    try {
      const created = await db.insert(doc);
      return res.status(201).json(mapDocToResponse(created));
    } catch (err) {
      if (!useInMemory && err && err.code === 11000) {
        return res.status(409).json({ error: 'Conflict', message: 'String already exists in the system' });
      }
      if (useInMemory && inMemoryStore.has(id)) {
        return res.status(409).json({ error: 'Conflict', message: 'String already exists in the system' });
      }
      console.error('POST /strings unexpected error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (err) {
    console.error('POST /strings error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /strings/:stringValue
app.delete('/strings/:stringValue', async (req, res) => {
  try {
    const id = calculateHash(req.params.stringValue);
    const result = await db.deleteOneById(id);
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'String does not exist in the system' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /strings/filter-by-natural-language
app.get('/strings/filter-by-natural-language', async (req, res) => {
  try {
    const q = req.query.query;
    if (!q) return res.status(400).json({ error: 'Bad Request', message: 'Missing "query" parameter' });

    const queryLower = q.toLowerCase();
    const parsed = {};
    if (queryLower.includes('palindrom')) parsed.is_palindrome = true;
    if (queryLower.includes('single word')) parsed.word_count = 1;
    const longerMatch = queryLower.match(/longer than (\d+)/);
    if (longerMatch) parsed.min_length = Number(longerMatch[1]) + 1;
    const containsMatch = queryLower.match(/contains? (?:the letter|character)? ([a-z])/);
    if (containsMatch) parsed.contains_character = containsMatch[1];

    if (Object.keys(parsed).length === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Unable to parse natural language query' });
    }

    const dbQuery = {};
    if (parsed.is_palindrome !== undefined) dbQuery['properties.is_palindrome'] = parsed.is_palindrome;
    if (parsed.word_count !== undefined) dbQuery['properties.word_count'] = parsed.word_count;
    if (parsed.min_length !== undefined) dbQuery['properties.length'] = { $gte: parsed.min_length };
    if (parsed.contains_character !== undefined) {
      const ch = parsed.contains_character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      dbQuery['value'] = { $regex: ch, $options: 'i' };
    }

    const results = await db.find(dbQuery);
    res.json({
      data: results.map(mapDocToResponse),
      count: results.length,
      interpreted_query: { original: q, parsed_filters: parsed }
    });
  } catch (err) {
    console.error('NLP filter error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /strings (with query filters)
app.get('/strings', async (req, res) => {
  try {
    const { is_palindrome, min_length, max_length, word_count, contains_character } = req.query;
    const filtersApplied = {};
    const dbQuery = {};

    if (is_palindrome !== undefined) {
      if (is_palindrome !== 'true' && is_palindrome !== 'false') {
        return res.status(400).json({ error: 'Bad Request', message: 'is_palindrome must be "true" or "false"' });
      }
      filtersApplied.is_palindrome = is_palindrome === 'true';
      dbQuery['properties.is_palindrome'] = filtersApplied.is_palindrome;
    }

    if (min_length !== undefined) {
      if (isNaN(min_length) || !Number.isInteger(Number(min_length))) {
        return res.status(400).json({ error: 'Bad Request', message: 'min_length must be integer' });
      }
      filtersApplied.min_length = Number(min_length);
      dbQuery['properties.length'] = dbQuery['properties.length'] || {};
      dbQuery['properties.length'].$gte = filtersApplied.min_length;
    }

    if (max_length !== undefined) {
      if (isNaN(max_length) || !Number.isInteger(Number(max_length))) {
        return res.status(400).json({ error: 'Bad Request', message: 'max_length must be integer' });
      }
      filtersApplied.max_length = Number(max_length);
      dbQuery['properties.length'] = dbQuery['properties.length'] || {};
      dbQuery['properties.length'].$lte = filtersApplied.max_length;
    }

    if (word_count !== undefined) {
      if (isNaN(word_count) || !Number.isInteger(Number(word_count))) {
        return res.status(400).json({ error: 'Bad Request', message: 'word_count must be integer' });
      }
      filtersApplied.word_count = Number(word_count);
      dbQuery['properties.word_count'] = filtersApplied.word_count;
    }

    if (contains_character !== undefined) {
      if (typeof contains_character !== 'string' || contains_character.length !== 1) {
        return res.status(400).json({ error: 'Bad Request', message: 'contains_character must be a single character' });
      }
      filtersApplied.contains_character = contains_character;
      const ch = contains_character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      dbQuery['value'] = { $regex: ch, $options: 'i' };
    }

    const docs = await db.find(dbQuery);
    res.json({ data: docs.map(mapDocToResponse), count: docs.length, filters_applied: Object.keys(filtersApplied).length ? filtersApplied : 'none' });
  } catch (err) {
    console.error('GET /strings error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET single
app.get('/strings/:stringValue', async (req, res) => {
  try {
    const id = calculateHash(req.params.stringValue);
    const doc = await db.findOneById(id);
    if (!doc) return res.status(404).json({ error: 'Not Found', message: 'String does not exist in the system' });
    res.json(mapDocToResponse(doc));
  } catch (err) {
    console.error('GET single error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Endpoint does not exist' });
});

// ---------------- Start ----------------
const PORT = process.env.PORT || 3000;

(async () => {
  await tryConnectMongoose(); // attempt DB connection but will not exit on failure
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} (using_in_memory=${useInMemory})`);
  });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT received, closing connections');
  try {
    if (!useInMemory) await mongoose.disconnect();
  } catch (_) {}
  process.exit(0);
});