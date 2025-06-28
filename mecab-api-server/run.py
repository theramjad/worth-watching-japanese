#!/usr/bin/env python3
"""
Simple runner script - just run: python run.py
"""

import subprocess
import sys
import os

def main():
    print("Starting MeCab API Server...")
    print("Running on http://localhost:9002")
    print("Press Ctrl+C to stop")
    print()
    
    # Run the simple app
    try:
        subprocess.run([sys.executable, "app.py"], cwd=os.path.dirname(__file__))
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == '__main__':
    main()