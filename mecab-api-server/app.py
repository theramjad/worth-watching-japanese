#!/usr/bin/env python3
"""
Worth Watching - YouTube Japanese Comprehension Analyzer
MeCab API Server

This Flask application provides Japanese morphological analysis using MeCab,
designed to work identically to AnkiMorphs for accurate comprehension scoring.

Endpoints:
- POST /analyze/<video_id> - Analyze video comprehension with CSV data
- GET /health - Health check (verifies MeCab is working)

The server fetches Japanese subtitles using youtube-transcript-api and analyzes
them using MeCab to calculate comprehension scores based on known morphs data.
"""

import os
import sys
import subprocess
import logging
import json
import io
import csv
import base64
import re
from pathlib import Path
from typing import Dict, Set, List, Tuple, Optional
from dataclasses import dataclass

from flask import Flask, request, jsonify
from flask_cors import CORS
import MeCab

# Add youtube-transcript-api to path for import
current_dir = Path(__file__).parent
youtube_transcript_dir = current_dir / "youtube-transcript-api"
if youtube_transcript_dir.exists():
    sys.path.insert(0, str(youtube_transcript_dir))

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    TRANSCRIPT_API_AVAILABLE = True
except ImportError:
    TRANSCRIPT_API_AVAILABLE = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app with CORS for Chrome extension
app = Flask(__name__)
CORS(app)

# Global MeCab instance
MECAB_TAGGER = None

def initialize_mecab():
    """
    Initialize MeCab with appropriate configuration.
    Uses default settings for compatibility with AnkiMorphs.
    """
    global MECAB_TAGGER
    try:
        # Use default MeCab configuration
        MECAB_TAGGER = MeCab.Tagger()
        logger.info("MeCab initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize MeCab: {e}")
        return False

class MeCabAnalyzer:
    """
    Japanese morphological analyzer using MeCab.
    Extracts morphemes in a format compatible with AnkiMorphs.
    """
    
    def __init__(self):
        self.mecab = MECAB_TAGGER
        if not self.mecab:
            raise Exception("MeCab not initialized")
    
    def extract_morphemes(self, text: str) -> List[Tuple[str, str]]:
        """
        Extract morphemes from Japanese text using MeCab.
        Returns list of (lemma, inflection) tuples.
        
        Args:
            text: Japanese text to analyze
            
        Returns:
            List of (lemma, inflection) tuples
        """
        if not text or not isinstance(text, str):
            return []
        
        # Add spaces and punctuation for better MeCab parsing
        processed_text = self.preprocess_text(text)
        
        try:
            # Parse with MeCab
            parsed = self.mecab.parse(processed_text)
            
            morphemes = []
            for line in parsed.split('\n'):
                if line == 'EOS' or not line.strip():
                    continue
                
                try:
                    parts = line.split('\t')
                    if len(parts) < 2:
                        continue
                    
                    inflection = parts[0]  # Surface form
                    features = parts[1].split(',')
                    
                    if len(features) < 7:
                        continue
                    
                    # Get lemma (base form) from features[6]
                    lemma = features[6] if features[6] != '*' else inflection
                    
                    # Filter out unwanted parts of speech like AnkiMorphs
                    pos = features[0]
                    if self.should_exclude_pos(pos):
                        continue
                    
                    morphemes.append((lemma, inflection))
                    
                except (IndexError, ValueError):
                    continue
            
            return morphemes
            
        except Exception as e:
            logger.error(f"MeCab parsing error: {e}")
            return []
    
    def preprocess_text(self, text: str) -> str:
        """
        Preprocess text for better MeCab analysis.
        Adds spaces around punctuation and normalizes whitespace.
        """
        # Add spaces around punctuation for better segmentation
        text = re.sub(r'([。、！？])', r' \1 ', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        return text
    
    def should_exclude_pos(self, pos: str) -> bool:
        """
        Check if a part of speech should be excluded from analysis.
        Excludes symbols, punctuation, and numbers like AnkiMorphs.
        """
        excluded_pos = [
            '記号',  # Symbols
            '補助記号',  # Auxiliary symbols
            '空白',  # Whitespace
        ]
        return pos in excluded_pos


class YouTubeSubtitleFetcher:
    """
    Fetches Japanese subtitles from YouTube videos using youtube-transcript-api.
    Handles both manual and auto-generated subtitles.
    """
    
    def __init__(self):
        if not TRANSCRIPT_API_AVAILABLE:
            logger.warning("youtube-transcript-api not available")
        
    def get_japanese_subtitles(self, video_id: str) -> Optional[str]:
        """
        Fetch Japanese subtitles for a YouTube video.
        
        Args:
            video_id: YouTube video ID
            
        Returns:
            Concatenated subtitle text or None if not available
        """
        if not TRANSCRIPT_API_AVAILABLE:
            logger.error("youtube-transcript-api not available")
            return None
        
        try:
            # Get available transcripts
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Look for Japanese transcripts (manual first, then auto-generated)
            japanese_transcript = None
            
            # Try manual Japanese transcripts first
            for transcript in transcript_list:
                if transcript.language_code == 'ja' and not transcript.is_generated:
                    japanese_transcript = transcript
                    logger.info(f"Found manual Japanese transcript for {video_id}")
                    break
            
            # Fall back to auto-generated if no manual transcript
            if not japanese_transcript:
                try:
                    japanese_transcript = transcript_list.find_transcript(['ja'])
                    logger.info(f"Found auto-generated Japanese transcript for {video_id}")
                except:
                    pass
            
            if not japanese_transcript:
                logger.info(f"No Japanese transcript found for {video_id}")
                return None
            
            # Fetch transcript data
            transcript_data = japanese_transcript.fetch()
            
            # Concatenate all text
            # Handle both dict format and FetchedTranscriptSnippet objects
            if transcript_data and hasattr(transcript_data[0], 'text'):
                # New API: FetchedTranscriptSnippet objects
                subtitle_text = ' '.join([entry.text for entry in transcript_data])
            elif transcript_data and isinstance(transcript_data[0], dict):
                # Old API: dictionary format
                subtitle_text = ' '.join([entry['text'] for entry in transcript_data])
            else:
                logger.error(f"Unexpected transcript format for {video_id}: {type(transcript_data[0]) if transcript_data else 'empty'}")
                return None
            
            logger.info(f"Successfully fetched Japanese subtitles for {video_id} ({len(subtitle_text)} characters)")
            return subtitle_text
            
        except Exception as e:
            logger.error(f"Error fetching subtitles for {video_id}: {e}")
            return None


class ComprehensionCalculator:
    """
    Calculates Japanese text comprehension scores using simple known/unknown logic.
    
    Uses binary categorization:
    - Known: morph exists in CSV data
    - Unknown: morph not in CSV data
    """
    
    def __init__(self):
        self.known_morphs: Set[str] = set()
        
    def load_known_morphs_from_csv(self, csv_content: str) -> bool:
        """
        Load known morphs from CSV content using simplified format.
        
        Expected CSV columns:
        - Morph-Lemma (required)
        - Morph-Inflection (required)
        
        Args:
            csv_content: CSV file content as string
            
        Returns:
            True if successful, False otherwise
        """
        try:
            self.known_morphs.clear()
            
            # Parse CSV content
            csv_file = io.StringIO(csv_content)
            reader = csv.DictReader(csv_file)
            
            count = 0
            for row in reader:
                # Get required columns
                lemma = row.get('Morph-Lemma', '').strip()
                inflection = row.get('Morph-Inflection', '').strip()
                
                # Both columns are required
                if lemma and inflection:
                    # Create AnkiMorph key: lemma + inflection
                    anki_morph_key = lemma + inflection
                    self.known_morphs.add(anki_morph_key)
                    count += 1
            
            logger.info(f"Loaded {count} known morphs from CSV")
            return count > 0
            
        except Exception as e:
            logger.error(f"Error loading known morphs from CSV: {e}")
            return False
    
    def calculate_comprehension(self, text: str, analyzer: MeCabAnalyzer) -> Dict:
        """
        Calculate comprehension score for Japanese text using AnkiMorphs logic.
        
        Args:
            text: Japanese text to analyze
            analyzer: MeCabAnalyzer instance
            
        Returns:
            Dictionary with comprehension statistics
        """
        if not text or not text.strip():
            return {
                'success': False,
                'error': 'No text provided',
                'video_id': None
            }
        
        # Extract morphemes using MeCab
        morphemes = analyzer.extract_morphemes(text)
        
        if not morphemes:
            return {
                'success': False,
                'error': 'Could not extract morphemes from text',
                'video_id': None
            }
        
        # Calculate comprehension score using the appropriate calculator
        score = self.calculate_comprehension_score(morphemes)
        
        logger.info(f"Video analysis complete: {score}% comprehension")
        
        return {
            'success': True,
            'video_id': None,
            'comprehension_score': score,
            'subtitle_length': len(text),
            'morpheme_count': len(morphemes),
            'known_morphs_total': len(self.known_morphs)
        }
    
    def calculate_comprehension_score(self, morphemes: List[Tuple[str, str]]) -> int:
        """Calculate comprehension score based on known morphs using simple known/unknown logic"""
        if not morphemes:
            return 0
            
        # Count morpheme occurrences using AnkiMorph format (lemma + inflection)
        morph_counts = {}
        for lemma, inflection in morphemes:
            # Create AnkiMorph-style key: lemma + inflection
            anki_morph_key = lemma + inflection
            morph_counts[anki_morph_key] = morph_counts.get(anki_morph_key, 0) + 1
        
        total_occurrences = sum(morph_counts.values())
        known_occurrences = 0
        unknown_occurrences = 0
        
        # Count known and unknown morphs by occurrence
        for morph, count in morph_counts.items():
            if self._is_known_morph(morph):
                known_occurrences += count
            else:
                unknown_occurrences += count
        
        # Calculate percentage based on known morphs
        if total_occurrences == 0:
            return 0
            
        score = int((known_occurrences / total_occurrences) * 100)
        
        # Debug logging
        logger.info(f"Morpheme analysis complete:")
        logger.info(f"  Total unique morphs: {len(morph_counts)}")
        logger.info(f"  Total occurrences: {total_occurrences}")
        logger.info(f"  Known occurrences: {known_occurrences}")
        logger.info(f"  Unknown occurrences: {unknown_occurrences}")
        logger.info(f"  Final score: {score}%")
        
        # Log some sample morphs for debugging
        sample_morphs = list(morph_counts.items())[:5]
        logger.info(f"Sample morphs: {sample_morphs}")
        
        return score
    
    def _is_known_morph(self, morph: str) -> bool:
        """Check if a morph is known (exists in CSV data)"""
        return morph in self.known_morphs

# Initialize components
if not initialize_mecab():
    logger.error("Failed to initialize MeCab - server will not work properly")
    MECAB_TAGGER = None

# Global instances
subtitle_fetcher = YouTubeSubtitleFetcher()
comprehension_calculator = ComprehensionCalculator()

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to verify server and MeCab are working.
    
    Returns:
        JSON with server status and MeCab availability
    """
    # Test MeCab functionality with a simple Japanese phrase
    mecab_working = False
    if MECAB_TAGGER is not None:
        try:
            test_morphemes = MeCabAnalyzer().extract_morphemes("こんにちは")
            mecab_working = len(test_morphemes) > 0
        except Exception as e:
            logger.error(f"MeCab test failed: {e}")
            mecab_working = False
    
    return jsonify({
        'status': 'OK',
        'message': 'MeCab API server is running',
        'mecab_working': mecab_working,
        'mecab_available': MECAB_TAGGER is not None,
        'known_morphs_loaded': len(comprehension_calculator.known_morphs) > 0,
        'known_morphs_count': len(comprehension_calculator.known_morphs)
    })

@app.route('/analyze/<video_id>', methods=['GET', 'POST'])
def analyze_video_comprehension(video_id):
    """
    Main analysis endpoint for video comprehension scoring.
    
    Accepts POST with CSV data or GET for testing.
    Fetches subtitles, analyzes with MeCab, and returns comprehension score.
    
    Args:
        video_id: YouTube video ID
        
    Request body (POST):
        {
            "csv_data": "base64-encoded CSV content"
        }
        
    Returns:
        JSON with comprehension score and analysis details
    """
    try:
        logger.info(f"Analyzing video: {video_id}")
        
        # Create a temporary comprehension calculator for this request
        temp_calculator = ComprehensionCalculator()
        
        # Handle different request methods
        if request.method == 'POST':
            # Get CSV data from request body
            data = request.get_json()
            
            if not data or 'csv_data' not in data:
                return jsonify({
                    'success': False,
                    'error': 'Missing csv_data field in request body',
                    'video_id': video_id
                }), 400
            
            # Decode base64 CSV data
            try:
                csv_bytes = base64.b64decode(data['csv_data'])
                csv_content = csv_bytes.decode('utf-8')
            except Exception as e:
                return jsonify({
                    'success': False,
                    'error': f'Invalid base64 CSV data: {e}',
                    'video_id': video_id
                }), 400
            
            # Load morphs from CSV for this request
            success = temp_calculator.load_known_morphs_from_csv(csv_content)
            
            if not success:
                return jsonify({
                    'success': False,
                    'error': 'Failed to load morphs from CSV data',
                    'video_id': video_id
                }), 400
                
            logger.info(f"Loaded {len(temp_calculator.known_morphs)} morphs from request CSV data")
            
        else:  # GET request - use global known morphs
            # Check if we have known morphs loaded globally
            if not comprehension_calculator.known_morphs:
                return jsonify({
                    'success': False,
                    'error': 'No known morphs loaded. Please include csv_data in POST request.',
                    'video_id': video_id
                }), 400
            
            # Use global calculator
            temp_calculator = comprehension_calculator
        
        # Fetch Japanese subtitles
        subtitles = subtitle_fetcher.get_japanese_subtitles(video_id)
        
        if not subtitles:
            return jsonify({
                'success': False,
                'error': 'No Japanese subtitles found for this video',
                'video_id': video_id
            }), 404
        
        # Calculate comprehension score using the appropriate calculator
        result = temp_calculator.calculate_comprehension(subtitles, MeCabAnalyzer())
        
        logger.info(f"Video {video_id} analysis complete: {result['comprehension_score']}% comprehension")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error analyzing video {video_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'video_id': video_id
        }), 500



if __name__ == '__main__':
    """
    Run the Flask development server.
    In production, use a proper WSGI server like gunicorn.
    """
    print("=" * 60)
    print("Worth Watching - MeCab API Server")
    print("=" * 60)
    print(f"MeCab Status: {'✓ Working' if MECAB_TAGGER else '✗ Failed'}")
    print(f"YouTube API: {'✓ Available' if TRANSCRIPT_API_AVAILABLE else '✗ Not Available'}")
    print()
    print("Endpoints:")
    print("  GET  /health - Health check")
    print("  POST /analyze/{video_id} - Analyze video comprehension (with CSV data)")
    print()
    print("Starting server on http://localhost:9002")
    print("=" * 60)
    
    try:
        app.run(host='0.0.0.0', port=9002, debug=False)
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"\nServer error: {e}")
        sys.exit(1)