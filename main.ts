import { Plugin, MarkdownPostProcessorContext, PluginSettingTab, Setting, App } from 'obsidian';
import { SQLiteQueryEngine } from './sqlite-engine';
import { Neo4jQueryEngine } from './neo4j-engine';
import { QueryResultRenderer } from './result-renderer';
import { GraphResultRenderer } from './graph-result-renderer';
import { PluginLogger } from './logger';

/**
 * Plugin settings interface
 */
interface DatabasePluginSettings {
    sqliteDatabasePath: string;
    neo4jDatabasePath: string;
    enableSQLite: boolean;
    enableNeo4j: boolean;
    maxResultRows: number;
}

/**
 * Default plugin settings
 */
const DEFAULT_SETTINGS: DatabasePluginSettings = {
    sqliteDatabasePath: '',
    neo4jDatabasePath: '',
    enableSQLite: true,
    enableNeo4j: true,
    maxResultRows: 1000
};

/**
 * Database plugin with full settings UI support
 */
export default class DatabasePlugin extends Plugin {
    settings: DatabasePluginSettings;
    private sqliteEngine: SQLiteQueryEngine | null = null;
    private neo4jEngine: Neo4jQueryEngine | null = null;
    private sqlResultRenderer: QueryResultRenderer;
    private graphResultRenderer: GraphResultRenderer;
    public logger: PluginLogger; // Make logger public for testing methods

    /**
     * Plugin initialization - called when plugin is loaded/enabled
     */
    async onload() {
        try {
            // Load plugin settings first
            await this.loadSettings();

            // Initialize logger with plugin-specific context
            this.logger = new PluginLogger('DatabasePlugin', this.app.vault.getName());
            this.logger.info('Initializing Database Plugin (SQLite + Neo4j)...', {
                sqliteEnabled: this.settings.enableSQLite,
                neo4jEnabled: this.settings.enableNeo4j,
                sqlitePath: this.settings.sqliteDatabasePath || 'mock data',
                neo4jPath: this.settings.neo4jDatabasePath || 'mock data'
            });

            // Initialize result renderers first (no dependencies)
            this.sqlResultRenderer = new QueryResultRenderer(this.logger);
            this.graphResultRenderer = new GraphResultRenderer(this.logger);

            // Initialize database engines based on settings
            await this.initializeDatabaseEngines();

            // Register markdown code block processors based on settings
            this.registerCodeBlockProcessors();

            // Add settings tab to Obsidian
            this.addSettingTab(new DatabaseSettingTab(this.app, this));
            
            this.logger.info('Database Plugin loaded successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Database Plugin', error);
            
            // Register error handlers for code blocks even if initialization failed
            this.registerErrorHandlers();
        }
    }

    /**
     * Plugin cleanup - called when plugin is unloaded/disabled
     */
    onunload() {
        try {
            this.logger.info('Unloading Database Plugin...');
            
            // Cleanup resources
            if (this.sqliteEngine) {
                this.sqliteEngine.cleanup();
            }
            
            if (this.neo4jEngine) {
                this.neo4jEngine.cleanup();
            }
            
            this.logger.info('Database Plugin unloaded successfully');
        } catch (error) {
            this.logger.error('Error during plugin unload', error);
        }
    }

    /**
     * Load plugin settings
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Save plugin settings
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Reinitialize database engines (called when settings change)
     */
    async reinitializeDatabases() {
        this.logger.info('Reinitializing databases due to settings change...');
        
        // Cleanup existing engines
        if (this.sqliteEngine) {
            this.sqliteEngine.cleanup();
            this.sqliteEngine = null;
        }
        if (this.neo4jEngine) {
            this.neo4jEngine.cleanup();
            this.neo4jEngine = null;
        }

        // Reinitialize with new settings
        await this.initializeDatabaseEngines();
        
        this.logger.info('Database reinitialization complete');
    }

    /**
     * Initialize both database engines based on settings
     */
    private async initializeDatabaseEngines(): Promise<void> {
        // Initialize SQLite engine if enabled
        if (this.settings.enableSQLite) {
            try {
                this.sqliteEngine = new SQLiteQueryEngine(this.logger, this.app);
                
                // Pass database path if provided, otherwise use mock data
                const dbPath = this.settings.sqliteDatabasePath.trim() || undefined;
                await this.sqliteEngine.initialize(dbPath);
                
                this.logger.info('SQLite engine initialized successfully', { 
                    configuredPath: dbPath || 'none',
                    hasExternalPath: !!dbPath
                });
            } catch (error) {
                this.logger.error('Failed to initialize SQLite engine', error);
                this.sqliteEngine = null;
            }
        } else {
            this.logger.info('SQLite engine disabled in settings');
            this.sqliteEngine = null;
        }

        // Initialize Neo4j engine if enabled
        if (this.settings.enableNeo4j) {
            try {
                this.neo4jEngine = new Neo4jQueryEngine(this.logger, this.app);
                
                // Pass database path if provided, otherwise use mock data
                const dbPath = this.settings.neo4jDatabasePath.trim() || undefined;
                await this.neo4jEngine.initialize(dbPath);
                
                this.logger.info('Neo4j engine initialized successfully', { 
                    configuredPath: dbPath || 'none',
                    hasExternalPath: !!dbPath
                });
            } catch (error) {
                this.logger.error('Failed to initialize Neo4j engine', error);
                this.neo4jEngine = null;
            }
        } else {
            this.logger.info('Neo4j engine disabled in settings');
            this.neo4jEngine = null;
        }
    }

    /**
     * Register code block processors based on settings
     */
    private registerCodeBlockProcessors(): void {
        // SQLite code blocks (only if enabled)
        if (this.settings.enableSQLite && this.sqliteEngine) {
            this.registerMarkdownCodeBlockProcessor('sql', this.processSQLCodeBlock.bind(this));
            this.registerMarkdownCodeBlockProcessor('sqlite', this.processSQLCodeBlock.bind(this));
            this.logger.debug('Registered SQLite code block processors');
        }

        // Neo4j code blocks (only if enabled)
        if (this.settings.enableNeo4j && this.neo4jEngine) {
            this.registerMarkdownCodeBlockProcessor('neo4j', this.processCypherCodeBlock.bind(this));
            this.registerMarkdownCodeBlockProcessor('cypher', this.processCypherCodeBlock.bind(this));
            this.logger.debug('Registered Neo4j code block processors');
        }
    }

    /**
     * Register error handlers for all code block types
     */
    private registerErrorHandlers(): void {
        this.registerMarkdownCodeBlockProcessor('sql', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('sqlite', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('neo4j', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('cypher', this.processErrorCodeBlock.bind(this));
    }

    /**
     * Process SQL code blocks and execute queries
     */
    private async processSQLCodeBlock(
        source: string, 
        el: HTMLElement, 
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        const startTime = performance.now();
        
        try {
            this.logger.debug('Processing SQL code block', { 
                source: this.truncateForLog(source, 100),
                file: ctx.sourcePath
            });

            // Check if SQLite engine is available
            if (!this.sqliteEngine) {
                throw new Error('SQLite engine not available. Check plugin settings - SQLite may be disabled.');
            }

            // Validate and clean the SQL query
            const cleanedSQL = this.validateAndCleanSQL(source);
            
            // Execute the query through SQLite engine
            const queryResult = await this.sqliteEngine.executeSelectQuery(cleanedSQL, {
                sourcePath: ctx.sourcePath,
                sourceElement: el
            });
            
            // Render the results using SQL result renderer
            await this.sqlResultRenderer.renderResults(queryResult, el, {
                sourcePath: ctx.sourcePath,
                originalQuery: source,
                maxRows: this.settings.maxResultRows
            });

            // Log successful execution
            const executionTime = performance.now() - startTime;
            this.logger.info('SQL query executed successfully', { 
                executionTime: `${executionTime.toFixed(2)}ms`,
                rowCount: queryResult.rows.length,
                file: ctx.sourcePath
            });

        } catch (error) {
            this.logger.error('Error processing SQL code block', error, {
                source: this.truncateForLog(source, 200),
                file: ctx.sourcePath
            });

            // Render error message using SQL result renderer
            this.sqlResultRenderer.renderError(error, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        }
    }

    /**
     * Process Cypher code blocks and execute queries
     */
    private async processCypherCodeBlock(
        source: string, 
        el: HTMLElement, 
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        const startTime = performance.now();
        
        try {
            this.logger.debug('Processing Cypher code block', { 
                source: this.truncateForLog(source, 100),
                file: ctx.sourcePath
            });

            // Check if Neo4j engine is available
            if (!this.neo4jEngine) {
                throw new Error('Neo4j engine not available. Check plugin settings - Neo4j may be disabled.');
            }

            // Validate and clean the Cypher query
            const cleanedCypher = this.validateAndCleanCypher(source);
            
            // Execute the query through Neo4j engine
            const queryResult = await this.neo4jEngine.executeCypherQuery(cleanedCypher, {
                sourcePath: ctx.sourcePath,
                sourceElement: el
            });
            
            // Render the results using graph result renderer
            await this.graphResultRenderer.renderGraphResults(queryResult, el, {
                sourcePath: ctx.sourcePath,
                originalQuery: source,
                maxRecords: this.settings.maxResultRows
            });

            // Log successful execution
            const executionTime = performance.now() - startTime;
            this.logger.info('Cypher query executed successfully', { 
                executionTime: `${executionTime.toFixed(2)}ms`,
                recordCount: queryResult.summary.recordCount,
                file: ctx.sourcePath
            });

        } catch (error) {
            this.logger.error('Error processing Cypher code block', error, {
                source: this.truncateForLog(source, 200),
                file: ctx.sourcePath
            });

            // Render error message using graph result renderer
            this.graphResultRenderer.renderGraphError(error, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        }
    }

    /**
     * Handle code blocks when plugin is in error state
     */
    private processErrorCodeBlock(
        source: string, 
        el: HTMLElement, 
        ctx: MarkdownPostProcessorContext
    ): void {
        // Determine which renderer to use based on content
        const isGraphQuery = source.toLowerCase().includes('match') || 
                           source.toLowerCase().includes('create') ||
                           source.toLowerCase().includes('cypher');

        const errorMessage = new Error('Database Plugin failed to initialize. Check the developer console for details.');
        
        if (isGraphQuery) {
            this.graphResultRenderer.renderGraphError(errorMessage, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        } else {
            this.sqlResultRenderer.renderError(errorMessage, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        }
    }

    /**
     * Validate and clean SQL query from markdown code block
     */
    private validateAndCleanSQL(rawSQL: string): string {
        if (!rawSQL || rawSQL.trim().length === 0) {
            throw new Error('Empty SQL query provided');
        }

        // Remove markdown artifacts and clean whitespace
        let cleaned = rawSQL
            .trim()
            .replace(/^\s*```sql\s*/i, '')   // Remove opening code fence
            .replace(/^\s*```sqlite\s*/i, '') // Remove SQLite opening code fence
            .replace(/\s*```\s*$/, '')       // Remove closing code fence
            .trim();

        // For now, only allow SELECT queries for security
        const upperSQL = cleaned.toUpperCase().trim();
        if (!upperSQL.startsWith('SELECT')) {
            throw new Error('Only SELECT queries are currently supported. Other SQL operations will be added in future versions.');
        }

        // Remove trailing semicolon if present (optional in SQLite)
        if (cleaned.endsWith(';')) {
            cleaned = cleaned.slice(0, -1).trim();
        }

        // Basic validation - ensure it's not empty after cleaning
        if (cleaned.length === 0) {
            throw new Error('No valid SQL query found after cleaning');
        }

        return cleaned;
    }

    /**
     * Validate and clean Cypher query from markdown code block
     */
    private validateAndCleanCypher(rawCypher: string): string {
        if (!rawCypher || rawCypher.trim().length === 0) {
            throw new Error('Empty Cypher query provided');
        }

        // Remove markdown artifacts and clean whitespace
        let cleaned = rawCypher
            .trim()
            .replace(/^\s*```neo4j\s*/i, '')  // Remove opening code fence
            .replace(/^\s*```cypher\s*/i, '') // Remove Cypher opening code fence
            .replace(/\s*```\s*$/, '')        // Remove closing code fence
            .trim();

        // Remove trailing semicolon if present (optional in Cypher)
        if (cleaned.endsWith(';')) {
            cleaned = cleaned.slice(0, -1).trim();
        }

        // Basic validation - ensure it's not empty after cleaning
        if (cleaned.length === 0) {
            throw new Error('No valid Cypher query found after cleaning');
        }

        return cleaned;
    }

    /**
     * Get connection status for settings display
     */
    getSQLiteStatus(): boolean {
        return this.sqliteEngine !== null;
    }

    getNeo4jStatus(): boolean {
        return this.neo4jEngine !== null;
    }

    /**
     * Get basic connection info for settings display
     */
    getSQLiteInfo(): string {
        if (!this.sqliteEngine) return 'Not Connected';
        const path = this.settings.sqliteDatabasePath.trim();
        return path ? `External: ${path}` : 'Mock Data';
    }

    getNeo4jInfo(): string {
        if (!this.neo4jEngine) return 'Not Connected';
        const path = this.settings.neo4jDatabasePath.trim();
        return path ? `External: ${path}` : 'Mock Data';
    }

    /**
     * Safely truncate strings for logging to avoid console spam
     */
    private truncateForLog(str: string, maxLength: number): string {
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }
}

/**
 * Settings tab for the Database Plugin
 */
class DatabaseSettingTab extends PluginSettingTab {
    plugin: DatabasePlugin;

    constructor(app: App, plugin: DatabasePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Database Plugin Settings' });
        
        containerEl.createEl('p', { 
            text: 'Configure database connections and execution options for SQL and Cypher queries.'
        });

        // SQLite Settings Section
        containerEl.createEl('h3', { text: 'SQLite Database (Relational)' });

        new Setting(containerEl)
            .setName('Enable SQLite')
            .setDesc('Enable SQL query execution with SQLite database')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSQLite)
                .onChange(async (value) => {
                    this.plugin.settings.enableSQLite = value;
                    await this.plugin.saveSettings();
                    // Reinitialize when settings change
                    await this.plugin.reinitializeDatabases();
                    this.display(); // Refresh the settings display
                }));

        if (this.plugin.settings.enableSQLite) {
            new Setting(containerEl)
                .setName('SQLite Database Path')
                .setDesc('Path to your SQLite database file (.db, .sqlite, .sqlite3). Leave empty to use mock data.')
                .addText(text => text
                    .setPlaceholder('/path/to/database.sqlite')
                    .setValue(this.plugin.settings.sqliteDatabasePath)
                    .onChange(async (value) => {
                        this.plugin.settings.sqliteDatabasePath = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Test Connection')
                    .onClick(async () => {
                        await this.testSQLiteConnection();
                    }));
        }

        // Neo4j Settings Section
        containerEl.createEl('h3', { text: 'Neo4j Database (Graph)' });

        new Setting(containerEl)
            .setName('Enable Neo4j')
            .setDesc('Enable Cypher query execution with Neo4j graph database')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableNeo4j)
                .onChange(async (value) => {
                    this.plugin.settings.enableNeo4j = value;
                    await this.plugin.saveSettings();
                    // Reinitialize when settings change
                    await this.plugin.reinitializeDatabases();
                    this.display(); // Refresh the settings display
                }));

        if (this.plugin.settings.enableNeo4j) {
            new Setting(containerEl)
                .setName('Neo4j Connection')
                .setDesc('Connection string for Neo4j (bolt://localhost:7687) or database path. Leave empty to use mock data.')
                .addText(text => text
                    .setPlaceholder('bolt://localhost:7687 or bolt://user:pass@localhost:7687')
                    .setValue(this.plugin.settings.neo4jDatabasePath)
                    .onChange(async (value) => {
                        this.plugin.settings.neo4jDatabasePath = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Test Connection')
                    .onClick(async () => {
                        await this.testNeo4jConnection();
                    }));
        }

        // General Settings Section
        containerEl.createEl('h3', { text: 'General Options' });

        new Setting(containerEl)
            .setName('Max Result Rows')
            .setDesc('Maximum number of rows/records to display (prevents UI freezing with large datasets)')
            .addSlider(slider => slider
                .setLimits(100, 5000, 100)
                .setValue(this.plugin.settings.maxResultRows)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxResultRows = value;
                    await this.plugin.saveSettings();
                }));

        // Connection Status Section
        containerEl.createEl('h3', { text: 'Connection Status' });
        
        const statusDiv = containerEl.createDiv({ cls: 'database-status' });
        
        // SQLite status
        const sqliteConnected = this.plugin.getSQLiteStatus();
        const sqliteInfo = this.plugin.getSQLiteInfo();
        
        statusDiv.createEl('p', { 
            text: `SQLite: ${sqliteConnected ? '✅' : '❌'} ${sqliteInfo}`,
            cls: sqliteConnected ? 'status-connected' : 'status-disconnected'
        });
        
        // Neo4j status
        const neo4jConnected = this.plugin.getNeo4jStatus();
        const neo4jInfo = this.plugin.getNeo4jInfo();
            
        statusDiv.createEl('p', { 
            text: `Neo4j: ${neo4jConnected ? '✅' : '❌'} ${neo4jInfo}`,
            cls: neo4jConnected ? 'status-connected' : 'status-disconnected'
        });

        // Setup Guide Section
        containerEl.createEl('h3', { text: 'Setup Guide' });
        
        const guideDiv = containerEl.createDiv({ cls: 'setup-guide' });
        
        guideDiv.createEl('h4', { text: 'SQLite Setup:' });
        guideDiv.createEl('p', { text: '1. Install the obsidian-sqlite3 plugin (recommended for file access)' });
        guideDiv.createEl('p', { text: '2. Create or locate your .sqlite/.db file' });
        guideDiv.createEl('p', { text: '3. Enter the full path: /path/to/your/database.sqlite' });
        guideDiv.createEl('p', { text: '4. Click "Test Connection" to verify' });
        
        guideDiv.createEl('h4', { text: 'Neo4j Setup:' });
        guideDiv.createEl('p', { text: '1. Install Neo4j Desktop or use Neo4j Aura (cloud)' });
        guideDiv.createEl('p', { text: '2. Start your database instance' });
        guideDiv.createEl('p', { text: '3. Use connection format: bolt://localhost:7687' });
        guideDiv.createEl('p', { text: '4. Include credentials: bolt://username:password@localhost:7687' });
        guideDiv.createEl('p', { text: '5. Click "Test Connection" to verify' });

        // Usage Examples Section
        containerEl.createEl('h3', { text: 'Usage Examples' });
        
        const examplesDiv = containerEl.createDiv({ cls: 'usage-examples' });
        
        examplesDiv.createEl('h4', { text: 'SQLite Queries:' });
        examplesDiv.createEl('pre', { 
            text: '```sql\nSELECT * FROM your_table LIMIT 10\nSELECT COUNT(*) FROM your_table\n```'
        });
        
        examplesDiv.createEl('h4', { text: 'Neo4j Queries:' });
        examplesDiv.createEl('pre', { 
            text: '```cypher\nMATCH (n) RETURN n LIMIT 10\nSHOW LABELS\n```'
        });

        // Add a refresh button
        new Setting(containerEl)
            .setName('Refresh Connections')
            .setDesc('Reload database connections with current settings')
            .addButton(button => button
                .setButtonText('Refresh')
                .setCta()
                .onClick(async () => {
                    await this.plugin.reinitializeDatabases();
                    this.display(); // Refresh the settings display
                }));
    }

    /**
     * Test SQLite database connection
     */
    private async testSQLiteConnection(): Promise<void> {
        const path = this.plugin.settings.sqliteDatabasePath.trim();
        
        if (!path) {
            this.showNotice('No SQLite database path configured. Using mock data.', 'info');
            return;
        }

        this.showNotice('Testing SQLite connection...', 'info');
        
        try {
            // Create temporary engine for testing
            const testEngine = new SQLiteQueryEngine(this.plugin.logger, this.app);
            await testEngine.initialize(path);
            
            // Test with a simple query
            await testEngine.executeSelectQuery('SELECT 1 as test', {});
            testEngine.cleanup();
            
            this.showNotice('✅ SQLite connection successful!', 'success');
        } catch (error) {
            this.showNotice(`❌ SQLite connection failed: ${error.message}`, 'error');
        }
    }

    /**
     * Test Neo4j database connection
     */
    private async testNeo4jConnection(): Promise<void> {
        const path = this.plugin.settings.neo4jDatabasePath.trim();
        
        if (!path) {
            this.showNotice('No Neo4j connection configured. Using mock data.', 'info');
            return;
        }

        this.showNotice('Testing Neo4j connection...', 'info');
        
        try {
            // Create temporary engine for testing
            const testEngine = new Neo4jQueryEngine(this.plugin.logger, this.app);
            await testEngine.initialize(path);
            
            // Test with a simple query
            await testEngine.executeCypherQuery('RETURN 1 as test', {});
            testEngine.cleanup();
            
            this.showNotice('✅ Neo4j connection successful!', 'success');
        } catch (error) {
            this.showNotice(`❌ Neo4j connection failed: ${error.message}`, 'error');
        }
    }

    /**
     * Show notice to user
     */
    private showNotice(message: string, type: 'info' | 'success' | 'error'): void {
        // Create a temporary notice element
        const notice = document.createElement('div');
        notice.style.cssText = `
            position: fixed;
            top: 50px;
            right: 20px;
            padding: 10px 15px;
            border-radius: 5px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            max-width: 300px;
            word-wrap: break-word;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        `;
        notice.textContent = message;
        
        document.body.appendChild(notice);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (notice.parentNode) {
                notice.parentNode.removeChild(notice);
            }
        }, 3000);
    }
}