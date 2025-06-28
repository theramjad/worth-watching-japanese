// CSV parser for AnkiMorphs known_morphs files
class AnkiMorphsCSVParser {
    /**
     * Parse AnkiMorphs CSV content into a morphs lookup object
     * @param {string} csvText - Raw CSV content
     * @returns {Object} Object with morph keys and their data
     */
    static parse(csvText) {
        if (!csvText || typeof csvText !== 'string') {
            throw new Error('Invalid CSV content');
        }

        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file must have a header row and at least one data row');
        }

        // Parse header to find column indices
        const headers = this.parseCSVLine(lines[0]);
        const columnIndices = this.findColumnIndices(headers);

        if (columnIndices.lemma === -1) {
            throw new Error('CSV file must contain a "Morph-Lemma" column');
        }

        if (columnIndices.inflection === -1) {
            throw new Error('CSV file must contain a "Morph-Inflection" column');
        }

        const morphs = {};
        let processedCount = 0;

        // Process each data row
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = this.parseCSVLine(lines[i]);
                const morphData = this.extractMorphData(values, columnIndices);

                if (morphData) {
                    // Create the proper AnkiMorphs key
                    const ankiMorphsKey = morphData.lemma + morphData.inflection;
                    morphs[ankiMorphsKey] = morphData;

                    processedCount++;
                }
            } catch (error) {
                console.warn(`Error parsing line ${i + 1}: ${error.message}`);
                // Continue processing other lines
            }
        }

        if (processedCount === 0) {
            throw new Error('No valid morphs found in CSV file');
        }

        console.log(`[JCA] Successfully parsed ${processedCount} morphs from CSV`);
        return morphs;
    }

    /**
     * Parse a single CSV line, handling quoted values and commas
     * @param {string} line - CSV line to parse
     * @returns {Array} Array of cell values
     */
    static parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        let i = 0;

        while (i < line.length) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i += 2;
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                    i++;
                }
            } else if (char === ',' && !inQuotes) {
                // End of field
                values.push(current.trim());
                current = '';
                i++;
            } else {
                current += char;
                i++;
            }
        }

        // Add the last field
        values.push(current.trim());

        return values;
    }

    /**
     * Find column indices for known headers
     * @param {Array} headers - Array of header strings
     * @returns {Object} Object with column indices
     */
    static findColumnIndices(headers) {
        const indices = {
            lemma: -1,
            inflection: -1,
            occurrence: -1,
            lemmaPriority: -1,
            inflectionPriority: -1,
            interval: -1,
            lemmaInterval: -1,
            inflectionInterval: -1
        };

        headers.forEach((header, index) => {
            const cleanHeader = header.trim().replace(/"/g, '');

            switch (cleanHeader) {
                case 'Morph-Lemma':
                    indices.lemma = index;
                    break;
                case 'Morph-Inflection':
                    indices.inflection = index;
                    break;
                case 'Occurrence':
                case 'Occurrences':
                    indices.occurrence = index;
                    break;
                case 'Lemma-Priority':
                    indices.lemmaPriority = index;
                    break;
                case 'Inflection-Priority':
                    indices.inflectionPriority = index;
                    break;
                case 'Interval':
                case 'Learning-Interval':
                case 'Highest-Learning-Interval':
                    indices.interval = index;
                    break;
                case 'Lemma-Interval':
                case 'Highest-Lemma-Learning-Interval':
                    indices.lemmaInterval = index;
                    break;
                case 'Inflection-Interval':
                case 'Highest-Inflection-Learning-Interval':
                    indices.inflectionInterval = index;
                    break;
            }
        });

        return indices;
    }

    /**
     * Extract morph data from a CSV row
     * @param {Array} values - Array of cell values
     * @param {Object} indices - Column indices object
     * @returns {Object|null} Morph data object or null if invalid
     */
    static extractMorphData(values, indices) {
        if (values.length <= indices.lemma) {
            return null;
        }

        const lemma = values[indices.lemma]?.trim().replace(/"/g, '');
        if (!lemma) {
            return null;
        }

        // Get inflection (default to lemma if not available)
        const inflection = indices.inflection !== -1 && values[indices.inflection]
            ? values[indices.inflection].trim().replace(/"/g, '')
            : lemma;

        // Get occurrence count if available
        let occurrence = 1;
        if (indices.occurrence !== -1 && values[indices.occurrence]) {
            const occurrenceStr = values[indices.occurrence].trim().replace(/"/g, '');
            const parsedOccurrence = parseInt(occurrenceStr);
            if (!isNaN(parsedOccurrence)) {
                occurrence = parsedOccurrence;
            }
        }

        // Get priority values if available
        let lemmaPriority = null;
        let inflectionPriority = null;

        if (indices.lemmaPriority !== -1 && values[indices.lemmaPriority]) {
            const priorityStr = values[indices.lemmaPriority].trim().replace(/"/g, '');
            const parsedPriority = parseFloat(priorityStr);
            if (!isNaN(parsedPriority)) {
                lemmaPriority = parsedPriority;
            }
        }

        if (indices.inflectionPriority !== -1 && values[indices.inflectionPriority]) {
            const priorityStr = values[indices.inflectionPriority].trim().replace(/"/g, '');
            const parsedPriority = parseFloat(priorityStr);
            if (!isNaN(parsedPriority)) {
                inflectionPriority = parsedPriority;
            }
        }

        // Get interval values if available (for proper AnkiMorphs classification)
        let interval = null;
        let lemmaInterval = null;
        let inflectionInterval = null;

        // General interval (could be lemma or inflection interval)
        if (indices.interval !== -1 && values[indices.interval]) {
            const intervalStr = values[indices.interval].trim().replace(/"/g, '');
            const parsedInterval = parseInt(intervalStr);
            if (!isNaN(parsedInterval)) {
                interval = parsedInterval;
            }
        }

        // Specific lemma interval
        if (indices.lemmaInterval !== -1 && values[indices.lemmaInterval]) {
            const intervalStr = values[indices.lemmaInterval].trim().replace(/"/g, '');
            const parsedInterval = parseInt(intervalStr);
            if (!isNaN(parsedInterval)) {
                lemmaInterval = parsedInterval;
            }
        }

        // Specific inflection interval
        if (indices.inflectionInterval !== -1 && values[indices.inflectionInterval]) {
            const intervalStr = values[indices.inflectionInterval].trim().replace(/"/g, '');
            const parsedInterval = parseInt(intervalStr);
            if (!isNaN(parsedInterval)) {
                inflectionInterval = parsedInterval;
            }
        }

        return {
            lemma: lemma,
            inflection: inflection,
            occurrence: occurrence,
            lemmaPriority: lemmaPriority,
            inflectionPriority: inflectionPriority,
            interval: interval,
            lemmaInterval: lemmaInterval,
            inflectionInterval: inflectionInterval
        };
    }

    /**
     * Validate if a string looks like AnkiMorphs CSV format
     * @param {string} csvText - CSV content to validate
     * @returns {boolean} True if it looks like valid AnkiMorphs CSV
     */
    static validate(csvText) {
        if (!csvText || typeof csvText !== 'string') {
            return false;
        }

        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            return false;
        }

        // Check if header contains required columns
        const headers = this.parseCSVLine(lines[0]);
        const hasLemmaColumn = headers.some(header =>
            header.trim().replace(/"/g, '') === 'Morph-Lemma'
        );

        return hasLemmaColumn;
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.AnkiMorphsCSVParser = AnkiMorphsCSVParser;
}