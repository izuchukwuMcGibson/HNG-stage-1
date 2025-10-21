#  String Analyzer API

A lightweight **Node.js + Express** API that analyzes strings for various properties such as length, palindrome status, word count, SHA256 hash, unique characters, and more.  
It also supports advanced filtering (including **natural language queries**) and provides full CRUD-like operations for managing analyzed strings.

---

##  Features

- Analyze any string and return detailed metadata
- Compute SHA256 hash for unique identification
- Check for palindromes and word counts
- Filter results by multiple query parameters
- Natural language query filtering (e.g. â€œstrings longer than 5â€, â€œsingle wordâ€, â€œcontains aâ€)
- Supports deletion and retrieval of specific strings

---

## Tech Stack

- **Node.js**
- **Express.js**
- **Crypto** (for hashing)
- **In-memory Map** (for data storage â€” no database required)

---

##  Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/string-analyzer-api.git
cd string-analyzer-api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Server

```bash
npm start
```

or if you have **nodemon** installed:

```bash
npx nodemon index.js
```

### 4. Access the Server

Once running, open your browser or Postman:

```
http://localhost:3000
```

---

##  API Endpoints

### **1. POST /strings**
Analyze and store a new string.

#### Example Request
```json
{
  "value": "racecar"
}
```

#### Example Response
```json
{
  "id": "hashed_value_here",
  "value": "racecar",
  "properties": {
    "length": 7,
    "is_palindrome": true,
    "unique_characters": 5,
    "word_count": 1,
    "sha256_hash": "6b32d98c...",
    "character_frequency_map": {
      "r": 2,
      "a": 2,
      "c": 2,
      "e": 1
    }
  },
  "created_at": "2025-10-21T09:32:00.000Z"
}
```

---

### **2. GET /strings**
Fetch all analyzed strings with optional query filters.

#### Query Parameters

| Parameter | Type | Description |
|------------|------|-------------|
| `is_palindrome` | `true` / `false` | Filter by palindrome |
| `min_length` | Integer | Minimum string length |
| `max_length` | Integer | Maximum string length |
| `word_count` | Integer | Exact word count |
| `contains_character` | String | Filter by character |

#### Example
```
GET /strings?is_palindrome=true&min_length=5
```

---

### **3. GET /strings/filter-by-natural-language**
Filter strings using **plain English queries**.

#### Example
```
GET /strings/filter-by-natural-language?query=strings longer than 4 that contain the letter a
```

#### Example Response
```json
{
  "data": [...],
  "count": 3,
  "interpreted_query": {
    "original": "strings longer than 4 that contain the letter a",
    "parsed_filters": {
      "min_length": 5,
      "contains_character": "a"
    }
  }
}
```

---

### **4. GET /strings/:stringValue**
Retrieve details of a specific string (by its value).

```
GET /strings/hello
```

---

### **5. DELETE /strings/:stringValue**
Remove a specific string from the system.

```
DELETE /strings/racecar
```

---

## Error Handling

All endpoints return JSON-formatted error messages:

| Status Code | Meaning |
|--------------|----------|
| `400` | Bad Request (invalid input) |
| `404` | Not Found |
| `409` | Conflict (duplicate string) |
| `422` | Unprocessable Entity (wrong data type) |

---

##  Example CURL Commands

```bash
# Add a new string
curl -X POST http://localhost:3000/strings -H "Content-Type: application/json" -d '{"value": "hello world"}'

# Get all strings
curl http://localhost:3000/strings

# Filter by palindrome
curl http://localhost:3000/strings?is_palindrome=true

# Delete a string
curl -X DELETE http://localhost:3000/strings/hello
```

---

## Environment Variables

You can optionally configure a port in a `.env` file:

```
PORT=4000
```

---

## Author

**McGibson Izuchukwu**  
[GitHub](https://github.com/izuchukwuMcGibson) | [LinkedIn](https://www.linkedin.com/in/mcgibson-izuchukwu-ba09a5311)

---

## License

This project is licensed under the **MIT License** â€“ youâ€™re free to use, modify, and distribute it.

