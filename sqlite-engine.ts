import { PluginLogger } from './logger';

/**
 * SQLite Query Engine - External databases only
 * No mock data - only connects to real SQLite databases
 */
export class SQLiteQueryEngine {
    private logger: PluginLogger;
    private database: any = null;
    private isExternalDatabase: boolean = false;
    private isInitialized: boolean = false;

    constructor(logger: PluginLogger) {
        this.logger = logger;
    }

    /**
     * Initialize the SQLite engine - external database only
     */
    async initialize(databasePath?: string): Promise<boolean> {
        this.logger.info('Initializing SQLite Query Engine...', { databasePath });

        if (!databasePath) {
            this.logger.warn('No database path provided - SQLite engine will not be available');
            return false;
        }

        try {
            // Attempt external database connection
            const connected = await this.tryExternalDatabase(databasePath);
            if (connected) {
                this.logger.info('External SQLite database connected successfully');
                this.isInitialized = true;
                return true;
            }

            this.logger.error('Failed to connect to external SQLite database');
            return false;

        } catch (error) {
            this.logger.error('Critical initialization error', error, {
                databasePath
            });
            return false;
        }
    }

    /**
     * Attempt to connect to external SQLite database
     */
    private async tryExternalDatabase(databasePath: string): Promise<boolean> {
        this.logger.info('Attempting external SQLite connection...', { path: databasePath });

        try {
            // Check for obsidian-sqlite3 plugin integration first
            const obsidianSqliteResult = await this.tryObsidianSqlitePlugin();
            if (obsidianSqliteResult) {
                this.logger.info('Connected via obsidian-sqlite3 plugin');
                return true;
            }

            // Try direct better-sqlite3 integration
            const directResult = await this.tryDirectSqliteConnection(databasePath);
            if (directResult) {
                this.logger.info('Connected via direct better-sqlite3');
                return true;
            }

            this.logger.error('All SQLite connection methods failed');
            return false;

        } catch (error) {
            this.logger.error('External database connection failed', error, {
                path: databasePath
            });
            return false;
        }
    }

    /**
     * Try to use obsidian-sqlite3 plugin if available
     */
    private async tryObsidianSqlitePlugin(): Promise<boolean> {
        try {
            // Check if obsidian-sqlite3 plugin is loaded
            const app = (window as any).app;
            if (!app?.plugins?.enabledPlugins?.has?.('obsidian-sqlite3')) {
                this.logger.info('obsidian-sqlite3 plugin not found or not enabled');
                return false;
            }

            const sqlitePlugin = app.plugins.plugins['obsidian-sqlite3'];
            if (sqlitePlugin?.api) {
                this.database = sqlitePlugin.api;
                this.isExternalDatabase = true;
                this.logger.info('Successfully connected via obsidian-sqlite3 plugin');
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warn('Failed to connect via obsidian-sqlite3 plugin', { error: error.message });
            return false;
        }
    }

    /**
     * Try direct better-sqlite3 connection
     */
    private async tryDirectSqliteConnection(databasePath: string): Promise<boolean> {
        try {
            this.logger.info('Attempting direct better-sqlite3 connection...', { path: databasePath });
            
            // Get resolved path first
            const resolvedPath = await this.getResolvedDatabasePath(databasePath);
            if (!resolvedPath) {
                this.logger.error('Database file not accessible', { path: databasePath });
                return false;
            }

            // Import better-sqlite3 using the same approach as the working plugin
            let Database;
            
            try {
                // Try the standard import approach first (like the working plugin)
                Database = await import('better-sqlite3');
                Database = Database.default || Database;
                this.logger.info('Loaded better-sqlite3 via import');
            } catch (importError) {
                this.logger.warn('Import failed, trying require', { error: importError.message });
                
                try {
                    // Fallback to require if import fails
                    Database = require('better-sqlite3');
                    this.logger.info('Loaded better-sqlite3 via require');
                } catch (requireError) {
                    this.logger.error('All better-sqlite3 loading methods failed', {
                        importError: importError.message,
                        requireError: requireError.message
                    });
                    return false;
                }
            }

            // Validate Database constructor
            if (!Database || typeof Database !== 'function') {
                this.logger.error('Database constructor not available', { 
                    Database: typeof Database,
                    hasDefault: !!(Database as any)?.default
                });
                return false;
            }

            // Create database connection using the working plugin's approach
            this.logger.info('Creating database connection...', { path: resolvedPath });
            
            try {
                // Use the exact same approach as the working plugin - simple and direct
                this.database = new Database(resolvedPath);
                this.logger.info('Database connection created successfully');
            } catch (constructorError) {
                this.logger.error('Database constructor failed', {
                    error: constructorError.message,
                    path: resolvedPath,
                    stack: constructorError.stack
                });
                return false;
            }

            // Test the connection
            try {
                this.logger.info('Testing database connection...');
                const testResult = this.database.prepare('SELECT 1 as test').get();
                
                if (testResult?.test === 1) {
                    this.isExternalDatabase = true;
                    this.logger.info('Direct SQLite connection successful', { 
                        testResult,
                        readonly: this.database.readonly || 'unknown'
                    });
                    return true;
                } else {
                    this.logger.error('Connection test failed - unexpected result', { testResult });
                    return false;
                }
            } catch (testError) {
                this.logger.error('Connection test query failed', {
                    error: testError.message,
                    stack: testError.stack
                });
                return false;
            }

        } catch (error) {
            this.logger.error('Direct better-sqlite3 connection failed', {
                path: databasePath,
                error: error.message,
                stack: error.stack,
                errorType: typeof error
            });
            return false;
        }
    }

    /**
     * Get resolved database path and verify accessibility
     */
    private async getResolvedDatabasePath(databasePath: string): Promise<string | null> {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Handle different path formats
            let resolvedPath = databasePath;
            
            // If it's a relative path, try to resolve it relative to the vault
            if (!path.isAbsolute(databasePath)) {
                // Try relative to current working directory
                const cwd = process.cwd();
                const relativeToCwd = path.resolve(cwd, databasePath);
                
                this.logger.info('Resolving relative path', {
                    original: databasePath,
                    cwd: cwd,
                    resolved: relativeToCwd
                });
                
                if (fs.existsSync(relativeToCwd)) {
                    resolvedPath = relativeToCwd;
                    this.logger.info('Found file relative to CWD', { path: resolvedPath });
                } else {
                    // Try some common locations
                    const possiblePaths = [
                        databasePath,
                        path.join(cwd, databasePath),
                        path.join(process.env.HOME || process.env.USERPROFILE || '', databasePath)
                    ];
                    
                    this.logger.info('Trying multiple path resolutions', { possiblePaths });
                    
                    for (const possiblePath of possiblePaths) {
                        if (fs.existsSync(possiblePath)) {
                            resolvedPath = possiblePath;
                            this.logger.info('Found file at', { path: resolvedPath });
                            break;
                        }
                    }
                }
            }
            
            // Final existence check
            if (!fs.existsSync(resolvedPath)) {
                this.logger.warn('Database file does not exist', { 
                    originalPath: databasePath,
                    resolvedPath: resolvedPath,
                    cwd: process.cwd()
                });
                return null;
            }

            // Check if file is readable
            try {
                fs.accessSync(resolvedPath, fs.constants.R_OK);
                this.logger.info('Database file verified', { 
                    originalPath: databasePath,
                    resolvedPath: resolvedPath,
                    size: fs.statSync(resolvedPath).size
                });
                
                return resolvedPath;
            } catch (accessError) {
                this.logger.warn('File exists but is not readable', {
                    path: resolvedPath,
                    error: accessError.message
                });
                return null;
            }

        } catch (error) {
            this.logger.warn('Path resolution failed', {
                path: databasePath,
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Execute SQL query - external database only
     */
    async executeQuery(query: string, sourcePath?: string): Promise<QueryResult> {
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = performance.now();

        this.logger.info('Starting query execution', {
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            executionId,
            sourcePath
        });

        try {
            // Check if engine is initialized
            if (!this.isInitialized || !this.database) {
                throw new Error('SQLite engine not initialized. No external database connection available.');
            }

            // Validate query
            if (!this.isValidQuery(query)) {
                throw new Error('Invalid or potentially unsafe query. Only SELECT queries are supported.');
            }

            const cleanQuery = query.trim();
            let results;

            // Execute query on external database
            if (this.isExternalDatabase && this.database.prepare) {
                const statement = this.database.prepare(cleanQuery);
                results = statement.all();
            } else {
                throw new Error('No external database connection available');
            }

            const executionTime = performance.now() - startTime;

            this.logger.info('Query executed successfully', {
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                rowCount: Array.isArray(results) ? results.length : 0,
                sourcePath
            });

            // Transform results to expected format
            const transformedResults = this.transformResults(results);

            return {
                success: true,
                data: transformedResults.data,
                columns: transformedResults.columns,
                rows: transformedResults.rows,
                rowCount: transformedResults.rows.length,
                executionTime: Math.round(executionTime),
                context: { executionId }
            };

        } catch (error) {
            const executionTime = performance.now() - startTime;

            this.logger.error('Query execution failed', error, {
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                sourcePath
            });

            return {
                success: false,
                error: `Query execution failed: ${error.message}`,
                executionTime: Math.round(executionTime),
                data: [],
                columns: [],
                rows: [],
                rowCount: 0,
                context: { executionId }
            };
        }
    }

    /**
     * Transform database results to expected format
     */
    private transformResults(results: any[]): { data: any[], columns: string[], rows: any[][] } {
        if (!Array.isArray(results) || results.length === 0) {
            return { data: [], columns: [], rows: [] };
        }

        const columns = Object.keys(results[0]);
        const rows = results.map(result => 
            columns.map(column => result[column])
        );

        return {
            data: results,
            columns,
            rows
        };
    }

    /**
     * Validate SQL query for security
     */
    private isValidQuery(query: string): boolean {
        const cleanQuery = query.trim().toLowerCase();
        
        if (!cleanQuery.startsWith('select')) {
            return false;
        }

        const dangerousPatterns = [
            /;\s*(drop|delete|insert|update|create|alter)/i,
            /--/,
            /\/\*/,
            /\*\//,
            /xp_/i,
            /sp_/i
        ];

        return !dangerousPatterns.some(pattern => pattern.test(query));
    }

    /**
     * Get database status
     */
    getStatus(): DatabaseStatus {
        return {
            isInitialized: this.isInitialized,
            isExternalDatabase: this.isExternalDatabase,
            databaseType: this.isExternalDatabase ? 'SQLite (External)' : 'Not Connected',
            hasActiveConnection: !!this.database,
            canExecuteQueries: this.isInitialized && !!this.database
        };
    }

    /**
     * Test database connection
     */
    async testConnection(): Promise<boolean> {
        try {
            if (!this.isInitialized || !this.database) {
                return false;
            }
            
            const result = await this.executeQuery('SELECT 1 as test');
            return result.success && result.data?.[0]?.test === 1;
        } catch (error) {
            this.logger.error('Connection test failed', error);
            return false;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        try {
            if (this.database && this.isExternalDatabase && typeof this.database.close === 'function') {
                this.database.close();
                this.logger.info('Database connection closed');
            }
            
            this.database = null;
            this.isInitialized = false;
            this.isExternalDatabase = false;
            
        } catch (error) {
            this.logger.error('Cleanup error', error);
        }
    }
}

/**
 * Type definitions for SQL query results
 */
export interface QueryResult {
    success: boolean;
    data: any[];
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number;
    error?: string;
    context?: {
        executionId: string;
    };
}

interface DatabaseStatus {
    isInitialized: boolean;
    isExternalDatabase: boolean;
    databaseType: string;
    hasActiveConnection: boolean;
    canExecuteQueries: boolean;
}