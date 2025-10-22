import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

const app = express();

/**
 * NOTE: we intentionally allow express.json to parse requests even when the
 * Content-Type header is missing in some test environments. This avoids a
 * common situation where tests send raw JSON without the header and the body
 * ends up empty (which previously caused POST to be treated as GET).
 *
 * If you prefer stricter behavior in production, change the `type` option.
 */
app.use(express.json({ limit: '1mb', type: '*/*' }));

// Simple CORS for testing (safe for the task environment)
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

// ---------------- Persistence (Mongoose fallback to in-memory) ----------------
let useInMemory = true;
const inMemoryStore = new Map();

const stringSchema = new mongoose.Schema({
  _id: { type: String }, // SHA256 hash as _id
  value: { type: String, required: true },
  properties: { type: Object, required: true },
  created_at: { type: Date, default: () => new Date().toISOString() }
}, { versionKey: false });

let StringModel = null;
let db = {
  insert: async (doc) => { inMemoryStore.set(doc._id, doc); return doc; },
  find: async (query) => {
    // simple in-memory query that supports the filters used in endpoints
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
  },
  findOneById: async (id) => inMemoryStore.get(id) || null,
  deleteOneById: async (id) => {
    const existed = inMemoryStore.delete(id);
    return { deletedCount: existed ? 1 : 0 };
  },
  count: async () => inMemoryStore.size
};

async function tryConnectMongoose() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('No MONGODB_URI provided: using in-memory store');
    useInMemory = true;
    return;
  }

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri);
    StringModel = mongoose.model('String', stringSchema);
    // swap db implementations
    db.insert = async (doc) => {
      const created = await StringModel.create(doc);
      return created.toObject ? created.toObject() : created;
    };
    db.find = async (query) => {
      const docs = await StringModel.find(query).lean().exec();
      return docs;
    };
    db.findOneById = async (id) => {
      return await StringModel.findById(id).lean().exec();
    };
    db.deleteOneById = async (id) => {
      const res = await StringModel.deleteOne({ _id: id });
      return { deletedCount: res.deletedCount ?? res.deletedCount ?? 0 };
    };
    db.count = async () => await StringModel.countDocuments();
    useInMemory = false;
    console.log('Connected to MongoDB (mongoose). Using persistent storage.');
  } catch (err) {
    console.error('Could not connect to MongoDB — falling back to in-memory store. Error:', err.message);
    useInMemory = true;
  }
}

// ---------------- Routes (ordered carefully) ----------------

// Health
app.get('/health', async (req, res) => {
  try {
    const count = await db.count();
    return res.json({ status: 'ok', storage_count: count, using_in_memory: useInMemory });
  } catch (err) {
    return  res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 1) POST /strings - Create / Analyze
app.post('/strings', async (req, res) => {
  try {
    // Validate presence of body and 'value' key explicitly
    if (!req.body || typeof req.body !== 'object' || !Object.prototype.hasOwnProperty.call(req.body, 'value')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "value" field' });
    }

    const { value } = req.body;

    if (typeof value !== 'string') {
      return res.status(422).json({ error: 'Unprocessable Entity', message: '"value" must be a string' });
    }

    const properties = computeStringProperties(value);
    const id = properties.sha256_hash;

    const doc = {
      _id: id,
      value,
      properties,
      created_at: new Date().toISOString()
    };

    if (useInMemory) {
      if (inMemoryStore.has(id)) {
        return res.status(409).json({ error: 'Conflict', message: 'String already exists in the system' });
      }
      const created = await db.insert(doc);
      return res.status(201).json({ id: created._id, value: created.value, properties: created.properties, created_at: created.created_at });
    }

    // persistent (mongoose) branch
    try {
      const created = await db.insert(doc);
      return res.status(201).json({ id: created._id, value: created.value, properties: created.properties, created_at: created.created_at });
    } catch (err) {
      // Duplicate key error
      if (err && (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000))) {
        return res.status(409).json({ error: 'Conflict', message: 'String already exists in the system' });
      }
      console.error('POST /strings unexpected DB error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (err) {
    console.error('POST /strings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2) DELETE /strings/:stringValue - Delete
app.delete('/strings/:stringValue', async (req, res) => {
  try {
    const id = calculateHash(req.params.stringValue);
    const result = await db.deleteOneById(id);
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'String does not exist in the system' });
    }
    // Must return 204 No Content with empty body
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /strings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3) GET /strings/filter-by-natural-language - specific route BEFORE general
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

    const mongoQuery = {};
    if (parsed.is_palindrome !== undefined) mongoQuery['properties.is_palindrome'] = parsed.is_palindrome;
    if (parsed.word_count !== undefined) mongoQuery['properties.word_count'] = parsed.word_count;
    if (parsed.min_length !== undefined) mongoQuery['properties.length'] = { $gte: parsed.min_length };
    if (parsed.contains_character !== undefined) {
      const ch = parsed.contains_character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      mongoQuery['value'] = { $regex: ch, $options: 'i' };
    }

    const results = await db.find(mongoQuery);
    const payload = results.map(r => ({ id: r._id ?? r.id, value: r.value, properties: r.properties, created_at: r.created_at }));
    return res.status(200).json({ data: payload, count: payload.length, interpreted_query: { original: q, parsed_filters: parsed } });
  } catch (err) {
    console.error('GET /strings/filter-by-natural-language error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4) GET /strings - general (after specific)
app.get('/strings', async (req, res) => {
  try {
    const { is_palindrome, min_length, max_length, word_count, contains_character } = req.query;
    const filtersApplied = {};
    const mongoQuery = {};

    if (is_palindrome !== undefined) {
      if (is_palindrome !== 'true' && is_palindrome !== 'false') {
        return res.status(400).json({ error: 'Bad Request', message: 'is_palindrome must be "true" or "false"' });
      }
      filtersApplied.is_palindrome = is_palindrome === 'true';
      mongoQuery['properties.is_palindrome'] = filtersApplied.is_palindrome;
    }

    if (min_length !== undefined) {
      if (isNaN(min_length) || !Number.isInteger(Number(min_length))) {
        return res.status(400).json({ error: 'Bad Request', message: 'min_length must be integer' });
      }
      filtersApplied.min_length = Number(min_length);
      mongoQuery['properties.length'] = mongoQuery['properties.length'] || {};
      mongoQuery['properties.length'].$gte = filtersApplied.min_length;
    }

    if (max_length !== undefined) {
      if (isNaN(max_length) || !Number.isInteger(Number(max_length))) {
        return res.status(400).json({ error: 'Bad Request', message: 'max_length must be integer' });
      }
      filtersApplied.max_length = Number(max_length);
      mongoQuery['properties.length'] = mongoQuery['properties.length'] || {};
      mongoQuery['properties.length'].$lte = filtersApplied.max_length;
    }

    if (word_count !== undefined) {
      if (isNaN(word_count) || !Number.isInteger(Number(word_count))) {
        return res.status(400).json({ error: 'Bad Request', message: 'word_count must be integer' });
      }
      filtersApplied.word_count = Number(word_count);
      mongoQuery['properties.word_count'] = filtersApplied.word_count;
    }

    if (contains_character !== undefined) {
      if (typeof contains_character !== 'string' || contains_character.length !== 1) {
        return res.status(400).json({ error: 'Bad Request', message: 'contains_character must be a single character' });
      }
      filtersApplied.contains_character = contains_character;
      const ch = contains_character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      mongoQuery['value'] = { $regex: ch, $options: 'i' };
    }

    const docs = await db.find(mongoQuery);
    const data = docs.map(r => ({ id: r._id ?? r.id, value: r.value, properties: r.properties, created_at: r.created_at }));
    return res.status(200).json({ data, count: data.length, filters_applied: Object.keys(filtersApplied).length ? filtersApplied : 'none' });
  } catch (err) {
    console.error('GET /strings error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 5) GET /strings/:stringValue - parameterized route LAST
app.get('/strings/:stringValue', async (req, res) => {
  try {
    const id = calculateHash(req.params.stringValue);
    const doc = await db.findOneById(id);
    if (!doc) return res.status(404).json({ error: 'Not Found', message: 'String does not exist in the system' });
    return res.status(200).json({ id: doc._id ?? doc.id, value: doc.value, properties: doc.properties, created_at: doc.created_at });
  } catch (err) {
    console.error('GET /strings/:stringValue error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 404 fallback
app.use((req, res) => {
 return res.status(404).json({ error: 'Not Found', message: 'Endpoint does not exist' });
});

// ---------------- Start ----------------
const PORT = process.env.PORT || 3000;

(async () => {
  await tryConnectMongoose();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (using_in_memory=${useInMemory})`);
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