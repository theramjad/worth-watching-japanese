/**
 * Settings page for YouTube Japanese Comprehension Analyzer
 * Handles CSV file upload, parsing, and storage of AnkiMorphs data
 */

document.addEventListener('DOMContentLoaded', async () => {
    // DOM element references
    const csvFile = document.getElementById('csvFile');
    const csvFileDisplay = document.getElementById('csvFileDisplay');
    const saveBtn = document.getElementById('saveBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const backBtn = document.getElementById('backBtn');

    // Stats elements
    const morphCount = document.getElementById('morphCount');
    const lastUpdated = document.getElementById('lastUpdated');

    // State
    let uploadedMorphs = null;

    // Initialize page
    await loadCurrentSettings();

    // File input handlers - support both click and drag & drop
    csvFile.addEventListener('change', handleFileSelect);
    csvFileDisplay.addEventListener('dragover', handleDragOver);
    csvFileDisplay.addEventListener('drop', handleFileDrop);

    // Form handlers
    saveBtn.addEventListener('click', saveConfiguration);
    clearBtn.addEventListener('click', clearAllData);
    backBtn.addEventListener('click', () => window.close());

    /**
     * Load and display current extension configuration
     * Shows known morphs count and last update time
     */
    async function loadCurrentSettings() {
        try {
            const result = await chrome.storage.local.get([
                'knownMorphsBase64',
                'morphCount',
                'lastUpdated'
            ]);

            // Update stats display
            if (result.morphCount) {
                morphCount.textContent = result.morphCount.toLocaleString();
            }

            if (result.lastUpdated) {
                const date = new Date(result.lastUpdated);
                lastUpdated.textContent = date.toLocaleDateString();
            }

            validateForm();
        } catch (error) {
            console.error('[JCA] Error loading settings:', error);
            showStatus('Error loading current settings', 'error');
        }
    }

    /**
     * Handle file selection via file input click
     */
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            processFile(file);
        }
    }

    /**
     * Handle drag over event for file drop zone
     */
    function handleDragOver(event) {
        event.preventDefault();
        csvFileDisplay.style.borderColor = '#1976d2';
    }

    /**
     * Handle file drop for drag & drop CSV upload
     */
    function handleFileDrop(event) {
        event.preventDefault();
        csvFileDisplay.style.borderColor = '#ddd';

        const file = event.dataTransfer.files[0];
        if (file && file.type === 'text/csv') {
            csvFile.files = event.dataTransfer.files;
            processFile(file);
        } else {
            showStatus('Please drop a CSV file', 'error');
        }
    }

    /**
     * Process uploaded CSV file and store directly as base64
     * More efficient than parsing to objects since we send as base64 anyway
     */
    async function processFile(file) {
        try {
            showStatus('Processing CSV file...', 'success');

            const text = await file.text();

            // Validate CSV format without parsing to objects
            const morphCount = validateAnkiMorphsCSV(text);

            if (morphCount === 0) {
                throw new Error('No valid morphs found in CSV file');
            }

            // Store CSV directly as base64 (more efficient)
            uploadedMorphs = {
                csvBase64: btoa(unescape(encodeURIComponent(text))),
                morphCount: morphCount,
                fileName: file.name
            };

            csvFileDisplay.textContent = `${file.name} (${morphCount} morphs)`;
            csvFileDisplay.classList.add('has-file');

            showStatus(`Successfully processed ${morphCount} morphs`, 'success');
            validateForm();

        } catch (error) {
            console.error('[JCA] Error processing file:', error);
            showStatus(`Error processing file: ${error.message}`, 'error');
            uploadedMorphs = null;
            csvFileDisplay.classList.remove('has-file');
            validateForm();
        }
    }

    /**
     * Validate AnkiMorphs CSV format and count morphs
     * More efficient than full parsing since we store as base64 anyway
     * 
     * Expected CSV columns:
     * - Morph-Lemma (required): Base form of morphemes
     * - Morph-Inflection (required): Inflected forms
     */
    function validateAnkiMorphsCSV(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file must have a header row and at least one data row');
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const lemmaIndex = headers.indexOf('Morph-Lemma');
        const inflectionIndex = headers.indexOf('Morph-Inflection');

        if (lemmaIndex === -1) {
            throw new Error('CSV file must contain a "Morph-Lemma" column');
        }

        if (inflectionIndex === -1) {
            throw new Error('CSV file must contain a "Morph-Inflection" column');
        }

        // Count valid morphs without storing them
        let validMorphCount = 0;
        const seenMorphs = new Set();

        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length <= lemmaIndex) continue;

            const lemma = values[lemmaIndex]?.trim();
            if (!lemma) continue;

            const inflection = inflectionIndex !== -1 && values[inflectionIndex]
                ? values[inflectionIndex].trim()
                : lemma;

            // Create unique key to avoid counting duplicates
            const morphKey = lemma + '|' + inflection;
            if (!seenMorphs.has(morphKey)) {
                seenMorphs.add(morphKey);
                validMorphCount++;
            }
        }

        console.log(`[JCA] Validated ${validMorphCount} unique morphs in CSV`);
        return validMorphCount;
    }

    function parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }

        values.push(current.trim().replace(/^"|"$/g, ''));
        return values;
    }

    function validateForm() {
        const hasMorphs = uploadedMorphs || (morphCount.textContent !== '0' && morphCount.textContent !== '');
        saveBtn.disabled = !hasMorphs;
    }

    async function saveConfiguration() {
        try {
            saveBtn.disabled = true;
            showStatus('Saving configuration...', 'success');

            const config = {
                morphemizerType: 'mecab-api', // Always use MeCab API server
                lastUpdated: new Date().toISOString()
            };

            if (uploadedMorphs) {
                config.knownMorphsBase64 = uploadedMorphs.csvBase64;
                config.morphCount = uploadedMorphs.morphCount;
                config.fileName = uploadedMorphs.fileName;
            }

            await chrome.storage.local.set(config);

            showStatus('Configuration saved successfully!', 'success');
            await loadCurrentSettings();

            // Clear uploaded file state
            uploadedMorphs = null;
            csvFile.value = '';
            csvFileDisplay.textContent = 'Click to select CSV file or drag and drop here';
            csvFileDisplay.classList.remove('has-file');

        } catch (error) {
            console.error('Error saving configuration:', error);
            showStatus(`Error saving configuration: ${error.message}`, 'error');
        } finally {
            saveBtn.disabled = false;
        }
    }

    async function clearAllData() {
        if (!confirm('Are you sure you want to clear all stored data? This cannot be undone.')) {
            return;
        }

        try {
            await chrome.storage.local.clear();
            showStatus('All data cleared successfully', 'success');
            await loadCurrentSettings();

            // Reset form
            uploadedMorphs = null;
            csvFile.value = '';
            csvFileDisplay.textContent = 'Click to select CSV file or drag and drop here';
            csvFileDisplay.classList.remove('has-file');

        } catch (error) {
            console.error('Error clearing data:', error);
            showStatus(`Error clearing data: ${error.message}`, 'error');
        }
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';

        if (type === 'success') {
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 3000);
        }
    }
});