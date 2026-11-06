/**
 * Collection Import Module
 *
 * Handles the import workflow for JSON/GeoJSON files:
 * 1. File selection and parsing
 * 2. Field mapping between source and signal fields
 * 3. Preview and validation
 * 4. Bulk import to database
 */

const CollectionImport = {
    // State
    currentStep: 1,
    sourceData: null,
    sourceFields: [],
    mappings: {},
    previewIndex: 0,

    // Signal field definitions
    signalFields: [
        { key: 'source_id', label: 'Source ID', required: true, hint: 'Unique identifier from source' },
        { key: 'signal_type', label: 'Signal Type', required: true, hint: 'Classification or type' },
        { key: 'lon', label: 'Longitude', required: true, hint: 'X coordinate (WGS84)' },
        { key: 'lat', label: 'Latitude', required: true, hint: 'Y coordinate (WGS84)' },
        { key: 'confidence', label: 'Confidence', required: false, hint: 'Quality score 0-1' },
        { key: 'raw_payload', label: 'Raw Payload', required: false, hint: 'Store entire record' },
    ],

    // Auto-mapping rules: signal field -> array of possible source paths
    autoMappingRules: {
        lon: ['geometry.coordinates[0]', 'longitude', 'lng', 'lon', 'x', 'LONGITUDE', 'X'],
        lat: ['geometry.coordinates[1]', 'latitude', 'lat', 'y', 'LATITUDE', 'Y'],
        source_id: ['properties.SMRS', 'SMRS', 'id', 'ID', 'record_id', 'properties.id', 'feature_id'],
        signal_type: ['properties.MONUMENT_CLASS', 'MONUMENT_CLASS', 'type', 'TYPE', 'class', 'CLASS', 'category'],
        confidence: ['properties.confidence', 'confidence', 'quality', 'score'],
    },

    /**
     * Open the import modal
     */
    open() {
        this.reset();
        document.getElementById('import-modal').style.display = 'flex';
        this.setupEventListeners();
    },

    /**
     * Close the import modal
     */
    close() {
        document.getElementById('import-modal').style.display = 'none';
        this.removeEventListeners();
        this.reset();
    },

    /**
     * Reset state to initial values
     */
    reset() {
        this.currentStep = 1;
        this.sourceData = null;
        this.sourceFields = [];
        this.mappings = {};
        this.previewIndex = 0;

        // Reset UI
        this.updateStepIndicator();
        this.showStep(1);
        document.getElementById('file-info').style.display = 'none';
        document.getElementById('source-field-tree').innerHTML = '';
        document.getElementById('mapping-fields').innerHTML = '';
        document.getElementById('preview-content').innerHTML =
            '<p class="preview-placeholder">Click "Preview" to see the mapped signal</p>';
        document.getElementById('modal-next').disabled = true;
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Close button
        document.getElementById('import-modal-close').onclick = () => this.close();
        document.getElementById('modal-cancel').onclick = () => this.close();

        // Navigation buttons
        document.getElementById('modal-next').onclick = () => this.nextStep();
        document.getElementById('modal-back').onclick = () => this.prevStep();
        document.getElementById('modal-preview').onclick = () => this.loadPreview();
        document.getElementById('modal-import').onclick = () => this.submitCollection();

        // File drop zone
        const dropZone = document.getElementById('file-drop-zone');
        const fileInput = document.getElementById('file-input');

        dropZone.onclick = () => fileInput.click();

        dropZone.ondragover = (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        };

        dropZone.ondragleave = () => {
            dropZone.classList.remove('drag-over');
        };

        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) this.handleFileSelect(file);
        };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) this.handleFileSelect(file);
        };

        // Auto-map button
        document.getElementById('auto-map-btn').onclick = () => this.applyAutoMapping();

        // Preview navigation
        document.getElementById('prev-record').onclick = () => this.navigatePreview(-1);
        document.getElementById('next-record').onclick = () => this.navigatePreview(1);

        // Close on escape key
        this._escapeHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('keydown', this._escapeHandler);

        // Close on overlay click
        document.getElementById('import-modal').onclick = (e) => {
            if (e.target.id === 'import-modal') this.close();
        };
    },

    /**
     * Remove event listeners
     */
    removeEventListeners() {
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
        }
    },

    /**
     * Handle file selection
     */
    handleFileSelect(file) {
        if (!file.name.endsWith('.json') && !file.name.endsWith('.geojson')) {
            alert('Please select a JSON or GeoJSON file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                this.parseSourceData(content, file.name);
            } catch (err) {
                console.error('Error reading file:', err);
                alert('Error reading file: ' + err.message);
            }
        };
        reader.onerror = () => {
            alert('Error reading file');
        };
        reader.readAsText(file);
    },

    /**
     * Parse source data from JSON content
     */
    parseSourceData(content, fileName) {
        try {
            const data = JSON.parse(content);
            let records = [];

            // Handle GeoJSON FeatureCollection
            if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
                records = data.features;
            }
            // Handle plain JSON array
            else if (Array.isArray(data)) {
                records = data;
            }
            // Handle single object
            else if (typeof data === 'object') {
                records = [data];
            }

            if (records.length === 0) {
                alert('No records found in file');
                return;
            }

            this.sourceData = records;

            // Extract field paths from first record
            this.sourceFields = this.extractSourceFields(records[0]);

            // Update UI
            document.getElementById('selected-file-name').textContent = fileName;
            document.getElementById('record-count').textContent = `${records.length} records`;
            document.getElementById('file-info').style.display = 'flex';
            document.getElementById('modal-next').disabled = false;

            console.log(`Loaded ${records.length} records with ${this.sourceFields.length} fields`);

        } catch (err) {
            console.error('Error parsing JSON:', err);
            alert('Error parsing JSON: ' + err.message);
        }
    },

    /**
     * Extract field paths from a data object
     * Returns flat array of paths like: ['id', 'properties.name', 'geometry.coordinates[0]']
     */
    extractSourceFields(obj, prefix = '', depth = 0) {
        const fields = [];
        const maxDepth = 4;

        if (depth > maxDepth || obj === null || obj === undefined) {
            return fields;
        }

        if (Array.isArray(obj)) {
            // For arrays, extract paths for first few elements
            if (obj.length > 0 && typeof obj[0] !== 'object') {
                // Array of primitives - add indexed paths
                for (let i = 0; i < Math.min(obj.length, 3); i++) {
                    fields.push({
                        path: `${prefix}[${i}]`,
                        type: typeof obj[i],
                        sample: obj[i]
                    });
                }
            } else if (obj.length > 0 && typeof obj[0] === 'object') {
                // Array of objects - recurse into first element
                const nested = this.extractSourceFields(obj[0], `${prefix}[0]`, depth + 1);
                fields.push(...nested);
            }
        } else if (typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
                const path = prefix ? `${prefix}.${key}` : key;
                const value = obj[key];

                if (value === null || value === undefined) {
                    fields.push({ path, type: 'null', sample: null });
                } else if (typeof value === 'object') {
                    // Recurse into nested objects
                    const nested = this.extractSourceFields(value, path, depth + 1);
                    fields.push(...nested);
                } else {
                    fields.push({
                        path,
                        type: typeof value,
                        sample: value
                    });
                }
            }
        }

        return fields;
    },

    /**
     * Get value from object by path
     */
    getValueByPath(obj, path) {
        if (!path || !obj) return undefined;

        const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }

        return current;
    },

    /**
     * Navigate to next step
     */
    nextStep() {
        if (this.currentStep < 3) {
            this.currentStep++;
            this.showStep(this.currentStep);
            this.updateStepIndicator();

            if (this.currentStep === 2) {
                this.renderSourcePane();
                this.renderMappingPane();
            }
        }
    },

    /**
     * Navigate to previous step
     */
    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.showStep(this.currentStep);
            this.updateStepIndicator();
        }
    },

    /**
     * Show a specific step
     */
    showStep(step) {
        // Hide all steps
        document.querySelectorAll('.modal-step').forEach(el => el.classList.remove('active'));

        // Show target step
        const stepMap = { 1: 'step-file-select', 2: 'step-field-mapping', 3: 'step-preview' };
        document.getElementById(stepMap[step]).classList.add('active');

        // Update buttons
        const backBtn = document.getElementById('modal-back');
        const nextBtn = document.getElementById('modal-next');
        const previewBtn = document.getElementById('modal-preview');
        const importBtn = document.getElementById('modal-import');

        backBtn.style.display = step > 1 ? 'block' : 'none';
        nextBtn.style.display = step < 2 ? 'block' : 'none';
        previewBtn.style.display = step === 2 ? 'block' : 'none';
        importBtn.style.display = step === 3 ? 'block' : 'none';
    },

    /**
     * Update step indicator UI
     */
    updateStepIndicator() {
        document.querySelectorAll('.step-indicator .step').forEach((el, i) => {
            const stepNum = i + 1;
            el.classList.remove('active', 'completed');
            if (stepNum === this.currentStep) {
                el.classList.add('active');
            } else if (stepNum < this.currentStep) {
                el.classList.add('completed');
            }
        });
    },

    /**
     * Render source fields pane
     */
    renderSourcePane() {
        const container = document.getElementById('source-field-tree');
        container.innerHTML = '';

        for (const field of this.sourceFields) {
            const div = document.createElement('div');
            div.className = 'field-item';
            div.innerHTML = `
                <span class="field-path">${field.path}</span>
                <span class="field-type">(${field.type})</span>
            `;
            container.appendChild(div);
        }
    },

    /**
     * Render signal field mapping pane
     */
    renderMappingPane() {
        const container = document.getElementById('mapping-fields');
        container.innerHTML = '';

        for (const field of this.signalFields) {
            const row = document.createElement('div');
            row.className = 'mapping-row';

            const label = document.createElement('label');
            label.className = `mapping-label${field.required ? ' required' : ''}`;
            label.textContent = field.label;
            label.title = field.hint;

            const select = document.createElement('select');
            select.className = 'mapping-select';
            select.id = `mapping-${field.key}`;
            select.dataset.field = field.key;

            // Add empty option
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Select field --';
            select.appendChild(emptyOpt);

            // Add source field options
            for (const srcField of this.sourceFields) {
                const opt = document.createElement('option');
                opt.value = srcField.path;
                opt.textContent = srcField.path;
                select.appendChild(opt);
            }

            // Special option for raw_payload
            if (field.key === 'raw_payload') {
                const allOpt = document.createElement('option');
                allOpt.value = '__ENTIRE_RECORD__';
                allOpt.textContent = '(Entire record)';
                select.appendChild(allOpt);
            }

            // Track mapping changes
            select.onchange = (e) => {
                if (e.target.value) {
                    this.mappings[field.key] = e.target.value;
                } else {
                    delete this.mappings[field.key];
                }
            };

            row.appendChild(label);
            row.appendChild(select);
            container.appendChild(row);
        }
    },

    /**
     * Apply auto-mapping heuristics
     */
    applyAutoMapping() {
        const sourcePathSet = new Set(this.sourceFields.map(f => f.path));

        for (const [signalField, candidates] of Object.entries(this.autoMappingRules)) {
            const select = document.getElementById(`mapping-${signalField}`);
            if (!select) continue;

            // Find first matching candidate
            for (const candidate of candidates) {
                if (sourcePathSet.has(candidate)) {
                    select.value = candidate;
                    this.mappings[signalField] = candidate;
                    break;
                }
            }
        }

        console.log('Auto-mapping applied:', this.mappings);
    },

    /**
     * Load preview for current record
     */
    async loadPreview() {
        // Validate required mappings
        const requiredFields = this.signalFields.filter(f => f.required).map(f => f.key);
        const missing = requiredFields.filter(k => !this.mappings[k]);

        if (missing.length > 0) {
            alert(`Please map required fields: ${missing.join(', ')}`);
            return;
        }

        // Move to preview step
        this.currentStep = 3;
        this.showStep(3);
        this.updateStepIndicator();

        // Generate preview
        await this.previewSignal(this.previewIndex);
    },

    /**
     * Preview a single signal
     */
    async previewSignal(index) {
        if (!this.sourceData || index < 0 || index >= this.sourceData.length) {
            return;
        }

        const record = this.sourceData[index];
        const mappingList = Object.entries(this.mappings).map(([signalField, sourcePath]) => ({
            signal_field: signalField,
            source_path: sourcePath
        }));

        try {
            const response = await fetch('/api/collections/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record, mappings: mappingList })
            });

            if (!response.ok) {
                throw new Error(`Preview failed: ${response.status}`);
            }

            const result = await response.json();
            this.renderPreview(result);
        } catch (err) {
            console.error('Preview error:', err);
            document.getElementById('preview-content').innerHTML =
                `<p style="color: var(--accent-danger);">Error: ${err.message}</p>`;
        }

        // Update navigation
        document.getElementById('preview-index').textContent =
            `${index + 1} of ${this.sourceData.length}`;
        document.getElementById('prev-record').disabled = index === 0;
        document.getElementById('next-record').disabled = index >= this.sourceData.length - 1;
    },

    /**
     * Render preview result
     */
    renderPreview(result) {
        const container = document.getElementById('preview-content');
        container.innerHTML = '';

        // Signal entity section
        const signalSection = document.createElement('div');
        signalSection.className = 'preview-section';
        signalSection.innerHTML = `
            <h4 style="color: var(--accent-primary); margin-bottom: 0.5rem;">Signal Entity</h4>
            <pre style="margin: 0;">${JSON.stringify(result.signal, null, 2)}</pre>
        `;
        container.appendChild(signalSection);

        // Geometry section
        if (result.geometry) {
            const geoSection = document.createElement('div');
            geoSection.className = 'preview-section';
            geoSection.style.marginTop = '1rem';
            geoSection.innerHTML = `
                <h4 style="color: var(--accent-success); margin-bottom: 0.5rem;">Geometry State</h4>
                <pre style="margin: 0;">${JSON.stringify(result.geometry, null, 2)}</pre>
            `;
            container.appendChild(geoSection);
        }
    },

    /**
     * Navigate preview records
     */
    navigatePreview(delta) {
        const newIndex = this.previewIndex + delta;
        if (newIndex >= 0 && newIndex < this.sourceData.length) {
            this.previewIndex = newIndex;
            this.previewSignal(newIndex);
        }
    },

    /**
     * Submit collection for import
     */
    async submitCollection() {
        // Validate required mappings
        const requiredFields = this.signalFields.filter(f => f.required).map(f => f.key);
        const missing = requiredFields.filter(k => !this.mappings[k]);

        if (missing.length > 0) {
            alert(`Please map required fields: ${missing.join(', ')}`);
            return;
        }

        const importBtn = document.getElementById('modal-import');
        importBtn.disabled = true;
        importBtn.textContent = 'Importing...';

        const mappingList = Object.entries(this.mappings).map(([signalField, sourcePath]) => ({
            signal_field: signalField,
            source_path: sourcePath
        }));

        try {
            const response = await fetch('/api/collections/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('selected-file-name').textContent,
                    data: this.sourceData,
                    mappings: mappingList
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Import failed: ${response.status}`);
            }

            const result = await response.json();
            console.log('Import result:', result);

            alert(`Successfully imported ${result.imported} signals!`);
            this.close();

            // Refresh the signals list
            if (typeof loadSignals === 'function') {
                loadSignals().then(() => {
                    if (UASOApp.mapView) {
                        UASOApp.mapView.updateSignals(UASOApp.signals);
                    }
                });
            }

        } catch (err) {
            console.error('Import error:', err);
            alert('Import failed: ' + err.message);
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = 'Import Collection';
        }
    }
};

// Export for use in other modules
window.CollectionImport = CollectionImport;
