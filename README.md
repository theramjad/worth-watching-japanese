# Worth Watching - YouTube Japanese Comprehension Analyzer

A Chrome extension that analyzes Japanese YouTube videos based on your AnkiMorphs known words data to show comprehension scores. Includes a high-accuracy MeCab API server that provides identical results to AnkiMorphs.

## Project Structure

```
worth-watching/
├── chrome-extension/          # Chrome extension files
│   ├── manifest.json
│   ├── content/              # Content scripts for YouTube
│   ├── lib/                  # API handlers and utilities
│   ├── popup/                # Extension popup
│   ├── settings/             # Settings page
│   ├── background/           # Service worker
│   ├── icons/                # Extension icons
│   └── styles/               # CSS files
├── mecab-api-server/         # MeCab API server for accurate analysis
│   ├── app.py               # Flask application with Japanese morphological analysis
│   ├── install.py           # Auto-installer for MeCab dependencies
│   ├── run.py               # Server launcher
│   ├── requirements.txt     # Python dependencies
│   └── README.md            # API server documentation
└── ankimorph/                # AnkiMorphs source code (reference only)
```

## Features

- **High Accuracy Analysis**: Uses MeCab morphological analyzer for precise results matching AnkiMorphs
- **Real-time Comprehension Scoring**: Shows percentage of known words next to YouTube video titles
- **AnkiMorphs Integration**: Directly imports your AnkiMorphs CSV export data
- **Smart Content Detection**: Only analyzes Japanese videos and subtitles
- **Color-coded Results**: 
  - 🟢 Green (90%+): High comprehension
  - 🟡 Orange (70-89%): Medium comprehension
  - 🔴 Red (<70%): Low comprehension
- **Multi-page Support**: Works on YouTube homepage, search results, playlists, and watch pages
- **Intelligent Caching**: Avoids re-analyzing the same videos

## Quick Start

### 1. Set Up MeCab API Server

The MeCab API server provides morphological analysis identical to AnkiMorphs:

```bash
cd mecab-api-server
python install.py    # Auto-installs MeCab for your OS
python run.py        # Starts server on localhost:9002
```

**Server Endpoints:**
- `POST /analyze/{video_id}` - Analyze video with CSV data
- `GET /health` - Health check

### 2. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" and select the `chrome-extension` folder
4. The extension icon should appear in your toolbar

### 3. Configure Extension

1. Click the extension icon and go to "Settings"
2. Upload your AnkiMorphs CSV file:
   - Must include `Morph-Lemma` and `Morph-Inflection` columns
   - Optional: `Highest-Learning-Interval` for accurate known/learning/unknown categorization
3. Select "MeCab API" as your morphemizer (if server is running)
4. Save configuration

### 4. Use on YouTube

Navigate to YouTube and you'll see comprehension scores next to video titles!

## How It Works

### Analysis Pipeline
1. **Content Detection**: Identifies Japanese videos on YouTube pages
2. **Subtitle Extraction**: Fetches Japanese subtitles when available using YouTube Transcript API
3. **Morphological Analysis**: Uses MeCab to extract morphemes (lemma + inflection pairs)
4. **Score Display**: Shows colored percentage badges on video titles

### Key Technical Features
- **Exact AnkiMorphs Compatibility**: Uses identical morpheme key format (lemma+inflection)
- **Rate Limiting**: Prevents API overload with intelligent request timing
- **Error Handling**: Graceful fallback when subtitles or analysis fail

## File Structure

### Chrome Extension
```
chrome-extension/
├── manifest.json                 # Extension configuration
├── popup/
│   ├── popup.html               # Extension popup interface
│   └── popup.js                 # Popup functionality and stats
├── settings/
│   ├── settings.html            # Settings configuration page
│   └── settings.js              # CSV parsing and storage management
├── content/
│   └── youtube-content.js       # YouTube page integration and UI updates
├── background/
│   └── service-worker.js        # Background service worker
├── lib/
│   ├── csv-parser.js            # AnkiMorphs CSV parsing with interval support
│   └── youtube-api.js           # Video analysis and subtitle fetching
├── styles/
│   └── extension.css            # Extension styling
└── icons/                       # Extension icons
```

### MeCab API Server
```
mecab-api-server/
├── app.py                       # Main Flask application
│   ├── MeCabAnalyzer           # Japanese morpheme extraction
│   ├── YouTubeSubtitleFetcher  # Subtitle fetching with youtube-transcript-api
│   ├── ComprehensionCalculator # AnkiMorphs-compatible scoring
│   └── API endpoints           # /analyze, /test, /health
├── install.py                   # MeCab dependency installer
├── run.py                      # Server launcher
└── requirements.txt            # Python dependencies
```

## AnkiMorphs CSV Format

**Required Columns:**
- `Morph-Lemma`: Base form of words (e.g., "食べる")
- `Morph-Inflection`: Inflected forms (e.g., "食べた")

**Export from AnkiMorphs:**
1. Open AnkiMorphs → Generators → Known Morphs Exporter
2. Select "Inflections" (not just "Lemmas")
3. Ensure interval data is included
4. Export and upload to extension

## Troubleshooting

### Extension Issues

**No comprehension scores showing?**
- Check that the MeCab server is running (`python run.py`)
- Verify you've uploaded a valid AnkiMorphs CSV file
- Ensure you're on Japanese content (extension only analyzes Japanese videos)
- Check browser console for error messages (F12 → Console)

**Extension not loading?**
- Ensure Developer Mode is enabled in `chrome://extensions/`
- Check for permission errors in the extension console
- Try reloading the extension after code changes

### Server Issues

**MeCab server won't start?**
- Run `python install.py` to install MeCab dependencies
- Check that port 9002 is available
- Try running with `python app.py` directly for debug output

**Analysis failing?**
- Check server logs for Japanese subtitle fetching errors
- Verify video has Japanese subtitles available

### Common Fixes

**Accuracy Issues:**
1. Re-export CSV from AnkiMorphs with interval data
2. Reload Chrome extension after re-uploading CSV
3. Clear extension cache in settings
4. Restart MeCab server

**Performance Issues:**
1. Check rate limiting settings in youtube-api.js
2. Clear browser cache and extension storage
3. Restart browser if extension becomes unresponsive

## Contributing

Issues and pull requests welcome! When contributing:
- Test with real AnkiMorphs data
- Verify accuracy against AnkiMorphs readability reports
- Include documentation updates
- Follow existing code style and commenting

## License

This project is open source. Feel free to use and modify as needed.

---

**Note**: This extension is designed to complement AnkiMorphs for Japanese language learning. For best results, use with a well-maintained AnkiMorphs database with interval data.