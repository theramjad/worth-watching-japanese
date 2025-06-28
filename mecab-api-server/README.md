# MeCab API Server

A simple Flask-based REST API server that provides AnkiMorphs-compatible morphological analysis of Japanese text using MeCab.

## Super Simple Setup

### Option 1: Auto-install everything (Recommended)

```bash
cd mecab-api-server
python install.py
python run.py
```

That's it! The installer handles MeCab installation for your OS automatically.

### Option 2: Just run with fallback tokenizer

If you don't want to install MeCab, you can still run the server with simple tokenization:

```bash
cd mecab-api-server
pip install flask flask-cors
python run.py
```

## Features

- **AnkiMorphs Compatible**: Uses the same MeCab configuration as AnkiMorphs when available
- **Auto-fallback**: Works with simple tokenization if MeCab isn't installed
- **No Docker Required**: Pure Python solution
- **Easy Setup**: One command installation
- **CORS Enabled**: Works with Chrome extensions
- **Cross-platform**: Works on macOS, Linux, and Windows

## Manual Installation (if auto-install fails)

1. **Install MeCab:**
   ```bash
   # macOS
   brew install mecab mecab-ipadic
   
   # Ubuntu/Debian
   sudo apt-get install mecab mecab-ipadic-utf8 libmecab-dev
   
   # Windows: Download from https://taku910.github.io/mecab/
   ```

2. **Install Python dependencies:**
   ```bash
   pip install flask flask-cors mecab-python3
   ```

3. **Run the server:**
   ```bash
   python run.py
   ```

## API Endpoints

### POST /parse

Analyze Japanese text and return morphemes.

**Request:**
```json
{
  "text": "日本語のテキスト"
}
```

**Response:**
```json
{
  "morphemes": [
    {
      "lemma": "日本",
      "inflection": "日本"
    },
    {
      "lemma": "語",
      "inflection": "語"
    }
  ],
  "count": 2
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "mecab_working": true,
  "test_morphemes": 1
}
```

### GET /

API information and available endpoints.

## Configuration

The server uses the same MeCab configuration as AnkiMorphs:
- Node format: `%f[6]`, `%m`, `%f[7]`, `%f[0]`, `%f[1]`
- Filters out symbols, punctuation, and numbers
- Uses mecab-ipadic-neologd dictionary

## Integration with Chrome Extension

The Chrome extension in `../chrome-extension/` is configured to:
1. Try the MeCab API first (localhost:9002)
2. Fall back to simple tokenizer if API unavailable
3. Use the API results for more accurate comprehension scoring

## Development

To modify the MeCab configuration or add new endpoints, edit `app.py`. The current implementation exactly matches AnkiMorphs' morphological analysis behavior.

## Troubleshooting

- **MeCab not found**: Make sure MeCab is installed and in your PATH
- **Port 9002 in use**: Change the port in docker-compose.yml and update the Chrome extension
- **CORS errors**: The server includes CORS headers, but check your browser's console for specific issues