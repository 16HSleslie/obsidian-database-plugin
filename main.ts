import { Plugin, MarkdownPostProcessorContext, PluginSettingTab, Setting, App } from 'obsidian';
import { SQLiteQueryEngine } from './sqlite-engine';
import type { QueryResult } from './sqlite-engine';
import { Neo4jQueryEngine } from './neo4j-engine';
import type { GraphQueryResult } from './neo4j-engine';
import { QueryResultRenderer } from './result-renderer';
import { GraphResultRenderer } from './graph-result-renderer';
import { PluginLogger } from './logger';

interface DatabasePluginSettings {
    sqliteDatabasePath: string;
    neo4jDatabasePath: string;
    enableSQLite: boolean;
    enableNeo4j: boolean;
    maxResultRows: number;
}

const DEFAULT_SETTINGS: DatabasePluginSettings = {
    sqliteDatabasePath: '',
    neo4jDatabasePath: '',
    enableSQLite: true,
    enableNeo4j: true,
    maxResultRows: 1000
};

export default class DatabasePlugin extends Plugin {
    settings: DatabasePluginSettings;
    private sqliteEngine: SQLiteQueryEngine | null = null;
    private neo4jEngine: Neo4jQueryEngine | null = null;
    private sqlResultRenderer: QueryResultRenderer;
    private graphResultRenderer: GraphResultRenderer;
    public logger: PluginLogger;

    async onload() {
        try {
            await this.loadSettings();

            this.logger = new PluginLogger('DatabasePlugin', this.app.vault.getName());
            this.logger.info('Initializing Database Plugin (External databases only)...', {
                sqliteEnabled: this.settings.enableSQLite,
                neo4jEnabled: this.settings.enableNeo4j,
                sqlitePath: this.settings.sqliteDatabasePath || 'not configured',
                neo4jPath: this.settings.neo4jDatabasePath || 'not configured'
            });

            this.sqlResultRenderer = new QueryResultRenderer(this.logger);
            this.graphResultRenderer = new GraphResultRenderer(this.logger);

            await this.initializeDatabaseEngines();
            this.registerCodeBlockProcessors();
            this.addSettingTab(new DatabaseSettingTab(this.app, this));
            
            this.logger.info('Database Plugin loaded successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Database Plugin', error);
            this.registerErrorHandlers();
        }
    }

    onunload() {
        try {
            this.logger.info('Unloading Database Plugin...');
            
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async reinitializeDatabases() {
        this.logger.info('Reinitializing databases due to settings change...');
        
        if (this.sqliteEngine) {
            this.sqliteEngine.cleanup();
            this.sqliteEngine = null;
        }
        if (this.neo4jEngine) {
            this.neo4jEngine.cleanup();
            this.neo4jEngine = null;
        }

        await this.initializeDatabaseEngines();
        this.logger.info('Database reinitialization complete');
    }

    private async initializeDatabaseEngines(): Promise<void> {
        if (this.settings.enableSQLite) {
            try {
                this.sqliteEngine = new SQLiteQueryEngine(this.logger);
                const dbPath = this.settings.sqliteDatabasePath.trim() || undefined;
                const sqliteSuccess = await this.sqliteEngine.initialize(dbPath);
                
                this.logger.info('SQLite engine initialization result', { 
                    success: sqliteSuccess,
                    configuredPath: dbPath || 'none'
                });
            } catch (error) {
                this.logger.error('Failed to initialize SQLite engine', error);
                this.sqliteEngine = null;
            }
        } else {
            this.logger.info('SQLite engine disabled in settings');
            this.sqliteEngine = null;
        }

        if (this.settings.enableNeo4j) {
            try {
                this.neo4jEngine = new Neo4jQueryEngine(this.logger);
                const dbPath = this.settings.neo4jDatabasePath.trim() || undefined;
                const neo4jSuccess = await this.neo4jEngine.initialize(dbPath);
                
                this.logger.info('Neo4j engine initialization result', { 
                    success: neo4jSuccess,
                    configuredPath: dbPath || 'none'
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

    private registerCodeBlockProcessors(): void {
        if (this.settings.enableSQLite) {
            this.registerMarkdownCodeBlockProcessor('sql', this.processSQLCodeBlock.bind(this));
            this.registerMarkdownCodeBlockProcessor('sqlite', this.processSQLCodeBlock.bind(this));
            this.logger.debug('Registered SQLite code block processors');
        }

        if (this.settings.enableNeo4j) {
            this.registerMarkdownCodeBlockProcessor('neo4j', this.processCypherCodeBlock.bind(this));
            this.registerMarkdownCodeBlockProcessor('cypher', this.processCypherCodeBlock.bind(this));
            this.logger.debug('Registered Neo4j code block processors');
        }
    }

    private registerErrorHandlers(): void {
        this.registerMarkdownCodeBlockProcessor('sql', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('sqlite', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('neo4j', this.processErrorCodeBlock.bind(this));
        this.registerMarkdownCodeBlockProcessor('cypher', this.processErrorCodeBlock.bind(this));
    }

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

            if (!this.sqliteEngine) {
                throw new Error('SQLite engine not available. Check plugin settings and ensure external database is configured.');
            }

            const cleanedSQL = this.validateAndCleanSQL(source);
            const queryResult = await this.sqliteEngine.executeQuery(cleanedSQL, ctx.sourcePath);
            
            await this.sqlResultRenderer.renderResults(queryResult, el, {
                sourcePath: ctx.sourcePath,
                originalQuery: source,
                maxRows: this.settings.maxResultRows
            });

            const executionTime = performance.now() - startTime;
            this.logger.info('SQL query executed successfully', { 
                executionTime: `${executionTime.toFixed(2)}ms`,
                rowCount: queryResult.rowCount,
                file: ctx.sourcePath
            });

        } catch (error) {
            this.logger.error('Error processing SQL code block', error, {
                source: this.truncateForLog(source, 200),
                file: ctx.sourcePath
            });

            this.sqlResultRenderer.renderError(error, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        }
    }

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

            if (!this.neo4jEngine) {
                throw new Error('Neo4j engine not available. Check plugin settings and ensure external database is configured.');
            }

            const cleanedCypher = this.validateAndCleanCypher(source);
            const queryResult = await this.neo4jEngine.executeQuery(cleanedCypher, ctx.sourcePath);
            
            await this.graphResultRenderer.renderGraphResults(queryResult, el, {
                sourcePath: ctx.sourcePath,
                originalQuery: source,
                maxRecords: this.settings.maxResultRows
            });

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

            this.graphResultRenderer.renderGraphError(error, el, {
                originalQuery: source,
                sourcePath: ctx.sourcePath
            });
        }
    }

    private processErrorCodeBlock(
        source: string, 
        el: HTMLElement, 
        ctx: MarkdownPostProcessorContext
    ): void {
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

    private validateAndCleanSQL(rawSQL: string): string {
        if (!rawSQL || rawSQL.trim().length === 0) {
            throw new Error('Empty SQL query provided');
        }

        let cleaned = rawSQL
            .trim()
            .replace(/^\s*```sql\s*/i, '')
            .replace(/^\s*```sqlite\s*/i, '')
            .replace(/\s*```\s*$/, '')
            .trim();

        const upperSQL = cleaned.toUpperCase().trim();
        if (!upperSQL.startsWith('SELECT')) {
            throw new Error('Only SELECT queries are currently supported.');
        }

        if (cleaned.endsWith(';')) {
            cleaned = cleaned.slice(0, -1).trim();
        }

        if (cleaned.length === 0) {
            throw new Error('No valid SQL query found after cleaning');
        }

        return cleaned;
    }

    private validateAndCleanCypher(rawCypher: string): string {
        if (!rawCypher || rawCypher.trim().length === 0) {
            throw new Error('Empty Cypher query provided');
        }

        let cleaned = rawCypher
            .trim()
            .replace(/^\s*```neo4j\s*/i, '')
            .replace(/^\s*```cypher\s*/i, '')
            .replace(/\s*```\s*$/, '')
            .trim();

        if (cleaned.endsWith(';')) {
            cleaned = cleaned.slice(0, -1).trim();
        }

        if (cleaned.length === 0) {
            throw new Error('No valid Cypher query found after cleaning');
        }

        return cleaned;
    }

    getSQLiteStatus(): boolean {
        return this.sqliteEngine !== null && this.sqliteEngine.getStatus().canExecuteQueries;
    }

    getNeo4jStatus(): boolean {
        return this.neo4jEngine !== null && this.neo4jEngine.getStatus().canExecuteQueries;
    }

    getSQLiteInfo(): string {
        if (!this.sqliteEngine) return 'Not Connected';
        const status = this.sqliteEngine.getStatus();
        if (status.canExecuteQueries) {
            const path = this.settings.sqliteDatabasePath.trim();
            return path ? `Connected: ${path}` : 'Connected';
        }
        return 'Connection Failed';
    }

    getNeo4jInfo(): string {
        if (!this.neo4jEngine) return 'Not Connected';
        const status = this.neo4jEngine.getStatus();
        if (status.canExecuteQueries) {
            const path = this.settings.neo4jDatabasePath.trim();
            return path ? `Connected: ${path}` : 'Connected';
        }
        return 'Connection Failed';
    }

    private truncateForLog(str: string, maxLength: number): string {
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }
}

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
            text: 'Configure external database connections for SQL and Cypher queries. Only external databases are supported.'
        });

        // SQLite Settings Section
        containerEl.createEl('h3', { text: 'SQLite Database (Relational)' });

        new Setting(containerEl)
            .setName('Enable SQLite')
            .setDesc('Enable SQL query execution with external SQLite database')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSQLite)
                .onChange(async (value) => {
                    this.plugin.settings.enableSQLite = value;
                    await this.plugin.saveSettings();
                    await this.plugin.reinitializeDatabases();
                    this.display();
                }));

        if (this.plugin.settings.enableSQLite) {
            new Setting(containerEl)
                .setName('SQLite Database Path')
                .setDesc('Path to your SQLite database file (.db, .sqlite, .sqlite3). Required for SQLite functionality.')
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
            .setDesc('Enable Cypher query execution with external Neo4j database')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableNeo4j)
                .onChange(async (value) => {
                    this.plugin.settings.enableNeo4j = value;
                    await this.plugin.saveSettings();
                    await this.plugin.reinitializeDatabases();
                    this.display();
                }));

        if (this.plugin.settings.enableNeo4j) {
            new Setting(containerEl)
                .setName('Neo4j Connection')
                .setDesc('Connection string for Neo4j database. Format: bolt://username:password@host:port')
                .addText(text => text
                    .setPlaceholder('bolt://neo4j:password@localhost:7687')
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
            .setDesc('Maximum number of rows/records to display')
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
        containerEl.createEl('h3', { text: 'Setup Requirements' });
        
        const guideDiv = containerEl.createDiv({ cls: 'setup-guide' });
        
        guideDiv.createEl('h4', { text: 'SQLite Requirements:' });
        guideDiv.createEl('p', { text: '• Install obsidian-sqlite3 plugin for file access (recommended)' });
        guideDiv.createEl('p', { text: '• Create or locate your .sqlite/.db file' });
        guideDiv.createEl('p', { text: '• Enter the full path to your database file' });
        guideDiv.createEl('p', { text: '• Click "Test Connection" to verify access' });
        
        guideDiv.createEl('h4', { text: 'Neo4j Requirements:' });
        guideDiv.createEl('p', { text: '• Install and run Neo4j Desktop or use Neo4j Aura' });
        guideDiv.createEl('p', { text: '• Start your database instance' });
        guideDiv.createEl('p', { text: '• Use format: bolt://username:password@host:port' });
        guideDiv.createEl('p', { text: '• Click "Test Connection" to verify access' });

        // Add a refresh button
        new Setting(containerEl)
            .setName('Refresh Connections')
            .setDesc('Reload database connections with current settings')
            .addButton(button => button
                .setButtonText('Refresh')
                .setCta()
                .onClick(async () => {
                    await this.plugin.reinitializeDatabases();
                    this.display();
                }));
    }

    private async testSQLiteConnection(): Promise<void> {
        const path = this.plugin.settings.sqliteDatabasePath.trim();
        
        if (!path) {
            this.showNotice('❌ No SQLite database path configured. Please enter a database path.', 'error');
            return;
        }

        this.showNotice('🔄 Testing SQLite connection...', 'info');
        
        try {
            const testEngine = new SQLiteQueryEngine(this.plugin.logger);
            const success = await testEngine.initialize(path);
            testEngine.cleanup();
            
            if (success) {
                this.showNotice('✅ SQLite connection successful!', 'success');
            } else {
                this.showNotice('❌ SQLite connection failed. Check path and file permissions.', 'error');
            }
        } catch (error) {
            this.showNotice(`❌ SQLite connection failed: ${error.message}`, 'error');
        }
    }

    private async testNeo4jConnection(): Promise<void> {
        const path = this.plugin.settings.neo4jDatabasePath.trim();
        
        if (!path) {
            this.showNotice('❌ No Neo4j connection configured. Please enter a connection string.', 'error');
            return;
        }

        this.showNotice('🔄 Testing Neo4j connection...', 'info');
        
        try {
            const testEngine = new Neo4jQueryEngine(this.plugin.logger);
            const success = await testEngine.initialize(path);
            testEngine.cleanup();
            
            if (success) {
                this.showNotice('✅ Neo4j connection successful!', 'success');
            } else {
                this.showNotice('❌ Neo4j connection failed. Check connection string and database status.', 'error');
            }
        } catch (error) {
            this.showNotice(`❌ Neo4j connection failed: ${error.message}`, 'error');
        }
    }

    private showNotice(message: string, type: 'info' | 'success' | 'error'): void {
        const notice = document.createElement('div');
        notice.style.cssText = `
            position: fixed;
            top: 50px;
            right: 20px;
            padding: 12px 16px;
            border-radius: 6px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            max-width: 400px;
            word-wrap: break-word;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-size: 14px;
            line-height: 1.4;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        `;
        notice.textContent = message;
        
        document.body.appendChild(notice);
        
        setTimeout(() => {
            if (notice.parentNode) {
                notice.parentNode.removeChild(notice);
            }
        }, 5000);
    }
}