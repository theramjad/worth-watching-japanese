#!/usr/bin/env python3
"""
Installation script for MeCab API Server
Handles different operating systems automatically
"""

import subprocess
import sys
import platform
import os

def run_command(cmd, description):
    """Run a command and handle errors"""
    print(f"Running: {description}")
    try:
        result = subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        print(f"✓ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ {description} failed:")
        print(f"  Command: {cmd}")
        print(f"  Error: {e.stderr.strip()}")
        return False

def install_mecab():
    """Install MeCab based on the operating system"""
    system = platform.system().lower()
    
    print(f"Detected OS: {system}")
    print()
    
    if system == "darwin":  # macOS
        print("Installing MeCab on macOS using Homebrew...")
        
        # Check if brew is installed
        brew_check = subprocess.run("which brew", shell=True, capture_output=True)
        if brew_check.returncode != 0:
            print("✗ Homebrew not found. Please install Homebrew first:")
            print("  /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"")
            return False
        
        # Install MeCab
        if not run_command("brew install mecab mecab-ipadic", "Installing MeCab with Homebrew"):
            return False
            
    elif system == "linux":
        print("Installing MeCab on Linux...")
        
        # Try different package managers
        managers = [
            ("apt-get", "sudo apt-get update && sudo apt-get install -y mecab mecab-ipadic-utf8 libmecab-dev"),
            ("yum", "sudo yum install -y mecab mecab-ipadic mecab-devel"),
            ("dnf", "sudo dnf install -y mecab mecab-ipadic mecab-devel"),
            ("pacman", "sudo pacman -S mecab mecab-ipadic")
        ]
        
        success = False
        for manager, cmd in managers:
            if subprocess.run(f"which {manager}", shell=True, capture_output=True).returncode == 0:
                print(f"Found {manager}, using it to install MeCab...")
                if run_command(cmd, f"Installing MeCab with {manager}"):
                    success = True
                    break
        
        if not success:
            print("✗ Could not find a suitable package manager.")
            print("  Please install MeCab manually for your Linux distribution.")
            return False
            
    elif system == "windows":
        print("Windows detected. MeCab installation on Windows is complex.")
        print("Please follow these steps:")
        print("1. Download MeCab from: https://taku910.github.io/mecab/")
        print("2. Install the Windows binary")
        print("3. Add MeCab to your PATH")
        print("4. Run this script again")
        return False
        
    else:
        print(f"✗ Unsupported operating system: {system}")
        return False
    
    return True

def install_python_packages():
    """Install required Python packages"""
    print("Installing Python dependencies...")
    
    packages = ["flask", "flask-cors", "mecab-python3"]
    
    for package in packages:
        if not run_command(f"{sys.executable} -m pip install {package}", f"Installing {package}"):
            return False
    
    return True

def test_installation():
    """Test if MeCab is working"""
    print("Testing MeCab installation...")
    
    try:
        import MeCab
        tagger = MeCab.Tagger()
        result = tagger.parse("日本語")
        print("✓ MeCab is working correctly!")
        print(f"  Test result: {result.strip()}")
        return True
    except Exception as e:
        print(f"✗ MeCab test failed: {e}")
        return False

def main():
    print("=" * 60)
    print("MeCab API Server Installation Script")
    print("=" * 60)
    print()
    
    # Install MeCab
    if not install_mecab():
        print("\n✗ MeCab installation failed.")
        print("The server will still work with simple tokenization fallback.")
        print("You can run: python run.py")
        return
    
    # Install Python packages
    if not install_python_packages():
        print("\n✗ Python package installation failed.")
        return
    
    # Test installation
    if test_installation():
        print("\n🎉 Installation completed successfully!")
        print("\nTo start the server, run:")
        print("  python run.py")
        print("\nThe server will be available at: http://localhost:9002")
    else:
        print("\n⚠️  Installation completed but MeCab test failed.")
        print("The server will work with simple tokenization fallback.")
        print("\nTo start the server anyway, run:")
        print("  python run.py")

if __name__ == '__main__':
    main()