import express from 'express';
import crypto from 'crypto'

const app = express();

app.use(express.json());

const stringsStorage = new Map();

// ==================== HELPER FUNCTIONS ====================

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
  const words = value.trim().split(/\s+/).filter(word => word.length > 0);
  return words.length;
}

function createCharacterFrequencyMap(value) {
  const frequencyMap = {};
  for (let char of value) {
    if (frequencyMap[char]) {
      frequencyMap[char]++;
    } else {
      frequencyMap[char] = 1;
    }
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

// ==================== ROUTES ====================

// IMPORTANT: POST routes first (no conflicts)
// 1. POST /strings - Create/Analyze String
app.post('/strings', (req, res) => {
  console.log('📝 POST /strings called');
  console.log('Body:', req.body);

  if (!req.body) {
    return res.status(400).json({ 
      error: 'Bad Request',
      message: 'Request body is missing' 
    });
  }

  if (!('value' in req.body)) {
    return res.status(400).json({ 
      error: 'Bad Request',
      message: 'Missing "value" field' 
    });
  }

  const { value } = req.body;

  if (typeof value !== 'string') {
    return res.status(422).json({ 
      error: 'Unprocessable Entity',
      message: '"value" must be a string' 
    });
  }

  const properties = computeStringProperties(value);
  const id = properties.sha256_hash;

  if (stringsStorage.has(id)) {
    return res.status(409).json({ 
      error: 'Conflict',
      message: 'String already exists in the system' 
    });
  }

  const stringObject = {
    id,
    value,
    properties,
    created_at: new Date().toISOString()
  };

  stringsStorage.set(id, stringObject);
  console.log('✅ String stored. Total:', stringsStorage.size);
  
  res.status(201).json(stringObject);
});

// DELETE routes next
// 5. DELETE /strings/{string_value} - Delete String
app.delete('/strings/:stringValue', (req, res) => {
  const { stringValue } = req.params;
  const hash = calculateHash(stringValue);

  if (!stringsStorage.has(hash)) {
    return res.status(404).json({ 
      error: 'Not Found',
      message: 'String does not exist in the system' 
    });
  }

  stringsStorage.delete(hash);
  res.status(204).send();
});

// GET routes - SPECIFIC routes BEFORE general routes
// 4. GET /strings/filter-by-natural-language - Natural Language Filtering
app.get('/strings/filter-by-natural-language', (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ 
      error: 'Bad Request',
      message: 'Missing "query" parameter' 
    });
  }

  let parsedFilters = {};
  const queryLower = query.toLowerCase();

  if (queryLower.includes('palindrom')) {
    parsedFilters.is_palindrome = true;
  }

  if (queryLower.includes('single word')) {
    parsedFilters.word_count = 1;
  }

  const longerMatch = queryLower.match(/longer than (\d+)/);
  if (longerMatch) {
    parsedFilters.min_length = Number(longerMatch[1]) + 1;
  }

  if (queryLower.includes('first vowel') || queryLower.includes('vowel')) {
    parsedFilters.contains_character = 'a';
  }

  const containsMatch = queryLower.match(/contains? (?:the letter|character)? ([a-z])/);
  if (containsMatch) {
    parsedFilters.contains_character = containsMatch[1];
  }

  if (Object.keys(parsedFilters).length === 0) {
    return res.status(400).json({ 
      error: 'Bad Request',
      message: 'Unable to parse natural language query' 
    });
  }

  let results = Array.from(stringsStorage.values());

  if (parsedFilters.is_palindrome !== undefined) {
    results = results.filter(item => item.properties.is_palindrome === parsedFilters.is_palindrome);
  }

  if (parsedFilters.word_count !== undefined) {
    results = results.filter(item => item.properties.word_count === parsedFilters.word_count);
  }

  if (parsedFilters.min_length !== undefined) {
    results = results.filter(item => item.properties.length >= parsedFilters.min_length);
  }

  if (parsedFilters.contains_character !== undefined) {
    results = results.filter(item => item.value.includes(parsedFilters.contains_character));
  }

  res.status(200).json({
    data: results,
    count: results.length,
    interpreted_query: {
      original: query,
      parsed_filters: parsedFilters
    }
  });
});

// 3. GET /strings - Get All Strings with Filtering
app.get('/strings', (req, res) => {
  console.log('📖 GET /strings called');
  console.log('Storage size:', stringsStorage.size);
  
  const { is_palindrome, min_length, max_length, word_count, contains_character } = req.query;

  let filters = {};

  if (is_palindrome !== undefined) {
    if (is_palindrome !== 'true' && is_palindrome !== 'false') {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'is_palindrome must be "true" or "false"' 
      });
    }
    filters.is_palindrome = is_palindrome === 'true';
  }

  if (min_length !== undefined) {
    if (isNaN(min_length) || !Number.isInteger(Number(min_length))) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'min_length must be an integer' 
      });
    }
    filters.min_length = Number(min_length);
  }

  if (max_length !== undefined) {
    if (isNaN(max_length) || !Number.isInteger(Number(max_length))) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'max_length must be an integer' 
      });
    }
    filters.max_length = Number(max_length);
  }

  if (word_count !== undefined) {
    if (isNaN(word_count) || !Number.isInteger(Number(word_count))) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'word_count must be an integer' 
      });
    }
    filters.word_count = Number(word_count);
  }

  if (contains_character !== undefined) {
    if (typeof contains_character !== 'string' || contains_character.length !== 1) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'contains_character must be a single character' 
      });
    }
    filters.contains_character = contains_character;
  }

  let results = Array.from(stringsStorage.values());

  if (filters.is_palindrome !== undefined) {
    results = results.filter(item => item.properties.is_palindrome === filters.is_palindrome);
  }

  if (filters.min_length !== undefined) {
    results = results.filter(item => item.properties.length >= filters.min_length);
  }

  if (filters.max_length !== undefined) {
    results = results.filter(item => item.properties.length <= filters.max_length);
  }

  if (filters.word_count !== undefined) {
    results = results.filter(item => item.properties.word_count === filters.word_count);
  }

  if (filters.contains_character !== undefined) {
    results = results.filter(item => item.value.includes(filters.contains_character));
  }

  res.status(200).json({
    data: results,
    count: results.length,
    filters_applied: Object.keys(filters).length > 0 ? filters : 'none'
  });
});

// 2. GET /strings/{string_value} - Get Specific String (LAST because it has :param)
app.get('/strings/:stringValue', (req, res) => {
  const { stringValue } = req.params;
  const hash = calculateHash(stringValue);

  if (!stringsStorage.has(hash)) {
    return res.status(404).json({ 
      error: 'Not Found',
      message: 'String does not exist in the system' 
    });
  }

  const stringObject = stringsStorage.get(hash);
  res.status(200).json(stringObject);
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: 'Endpoint does not exist' 
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Ready!`);
});