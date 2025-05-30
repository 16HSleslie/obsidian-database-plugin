import { Logger } from './logger';

/**
 * SQLite Query Engine with robust dependency handling and fallback mechanisms
 * Handles both external SQLite connections and mock data for development
 */
export class SQLiteQueryEngine {
    private logger: Logger;
    private database: any = null;
    private isExternalDatabase: boolean = false;
    private isInitialized: boolean = false;
    private mockDatabase: MockSQLiteDatabase;

    constructor(logger: Logger) {
        this.logger = logger;
        this.mockDatabase = new MockSQLiteDatabase();
    }

    /**
     * Initialize the SQLite engine with comprehensive dependency checking
     * Falls back gracefully when external dependencies unavailable
     */
    async initialize(databasePath?: string): Promise<boolean> {
        this.logger.info('[QueryEngine] Initializing SQLite Query Engine...', { databasePath });

        try {
            // Attempt external database connection if path provided
            if (databasePath) {
                const externalConnected = await this.tryExternalDatabase(databasePath);
                if (externalConnected) {
                    this.logger.info('[QueryEngine] External SQLite database connected successfully');
                    this.isInitialized = true;
                    return true;
                }
            }

            // Fall back to mock database with proper initialization
            return await this.initializeMockDatabase();

        } catch (error) {
            this.logger.error('[QueryEngine] Critical initialization error', {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });
            
            // Ensure we always have a working fallback
            return await this.initializeMockDatabase();
        }
    }

    /**
     * Attempt to connect to external SQLite database with proper error handling
     */
    private async tryExternalDatabase(databasePath: string): Promise<boolean> {
        this.logger.info('[QueryEngine] Attempting external SQLite connection...', { path: databasePath });

        try {
            // Check for obsidian-sqlite3 plugin integration first
            const obsidianSqliteResult = await this.tryObsidianSqlitePlugin();
            if (obsidianSqliteResult) {
                this.logger.info('[QueryEngine] Connected via obsidian-sqlite3 plugin');
                return true;
            }

            // Try direct better-sqlite3 integration
            const directResult = await this.tryDirectSqliteConnection(databasePath);
            if (directResult) {
                this.logger.info('[QueryEngine] Connected via direct better-sqlite3');
                return true;
            }

            this.logger.warn('[QueryEngine] All external connection methods failed, using mock database');
            return false;

        } catch (error) {
            this.logger.error('[QueryEngine] External database connection failed', {
                path: databasePath,
                errorName: error.name,
                errorMessage: error.message
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
                this.logger.info('[QueryEngine] obsidian-sqlite3 plugin not found or not enabled');
                return false;
            }

            const sqlitePlugin = app.plugins.plugins['obsidian-sqlite3'];
            if (sqlitePlugin?.api) {
                this.database = sqlitePlugin.api;
                this.isExternalDatabase = true;
                this.logger.info('[QueryEngine] Successfully connected via obsidian-sqlite3 plugin');
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warn('[QueryEngine] Failed to connect via obsidian-sqlite3 plugin', { error: error.message });
            return false;
        }
    }

    /**
     * Try direct better-sqlite3 connection with Electron-compatible loading
     */
    private async tryDirectSqliteConnection(databasePath: string): Promise<boolean> {
        try {
            // Multiple approaches for loading better-sqlite3 in Electron environment
            let Database;
            
            try {
                // Standard require (may work in some Electron configurations)
                Database = require('better-sqlite3');
            } catch (requireError) {
                try {
                    // Try dynamic import (modern alternative)
                    const module = await import('better-sqlite3');
                    Database = module.default || module;
                } catch (importError) {
                    try {
                        // Try Electron-specific loading
                        const { remote } = require('electron');
                        Database = remote.require('better-sqlite3');
                    } catch (electronError) {
                        this.logger.warn('[QueryEngine] All better-sqlite3 loading methods failed', {
                            requireError: requireError.message,
                            importError: importError.message,
                            electronError: electronError.message
                        });
                        return false;
                    }
                }
            }

            // Verify file exists and is accessible
            if (!await this.verifyDatabaseFile(databasePath)) {
                this.logger.error('[QueryEngine] Database file not accessible', { path: databasePath });
                return false;
            }

            // Create database connection
            this.database = new Database(databasePath, { 
                readonly: true,  // Start with read-only for safety
                fileMustExist: true
            });

            // Test the connection
            const testResult = this.database.prepare('SELECT 1 as test').get();
            if (testResult?.test === 1) {
                this.isExternalDatabase = true;
                this.logger.info('[QueryEngine] Direct SQLite connection successful');
                return true;
            }

            return false;

        } catch (error) {
            this.logger.warn('[QueryEngine] Direct better-sqlite3 connection failed', {
                path: databasePath,
                errorName: error.name,
                errorMessage: error.message
            });
            return false;
        }
    }

    /**
     * Verify database file exists and is accessible
     */
    private async verifyDatabaseFile(databasePath: string): Promise<boolean> {
        try {
            // Check if file exists using multiple methods
            const fs = require('fs');
            
            // Check if file exists
            if (!fs.existsSync(databasePath)) {
                this.logger.warn('[QueryEngine] Database file does not exist', { path: databasePath });
                return false;
            }

            // Check if file is readable
            fs.accessSync(databasePath, fs.constants.R_OK);
            
            this.logger.info('[QueryEngine] Database file verified', { path: databasePath });
            return true;

        } catch (error) {
            this.logger.warn('[QueryEngine] File verification failed', {
                path: databasePath,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Initialize mock database with proper error handling
     */
    private async initializeMockDatabase(): Promise<boolean> {
        try {
            this.logger.info('[QueryEngine] Initializing mock SQLite database...');
            
            // Initialize mock database
            await this.mockDatabase.initialize();
            this.database = this.mockDatabase;
            this.isExternalDatabase = false;
            this.isInitialized = true;

            // Test mock database
            const testResult = await this.executeQuery('SELECT 1 as test');
            if (testResult.success) {
                this.logger.info('[QueryEngine] Mock database initialized successfully');
                return true;
            } else {
                throw new Error('Mock database test query failed');
            }

        } catch (error) {
            this.logger.error('[QueryEngine] Mock database initialization failed', {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });
            return false;
        }
    }

    /**
     * Execute SQL query with comprehensive error handling and performance monitoring
     */
    async executeQuery(query: string, sourcePath?: string): Promise<QueryResult> {
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = performance.now();

        this.logger.info('[QueryEngine] Starting query execution', {
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            executionId,
            sourcePath
        });

        try {
            // Check if engine is initialized
            if (!this.isInitialized || !this.database) {
                throw new Error('SQLite engine not initialized. Please check database connection.');
            }

            // Validate query (basic SQL injection prevention)
            if (!this.isValidQuery(query)) {
                throw new Error('Invalid or potentially unsafe query. Only SELECT queries are supported.');
            }

            let results;
            const cleanQuery = query.trim();

            // Execute query based on database type
            if (this.isExternalDatabase && this.database.prepare) {
                // Real SQLite database
                const statement = this.database.prepare(cleanQuery);
                results = statement.all();
            } else if (this.mockDatabase && typeof this.database.query === 'function') {
                // Mock database
                results = await this.database.query(cleanQuery);
            } else {
                throw new Error('Database interface not available');
            }

            const executionTime = performance.now() - startTime;

            this.logger.info('[QueryEngine] Query executed successfully', {
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                rowCount: Array.isArray(results) ? results.length : 0,
                sourcePath
            });

            return {
                success: true,
                data: Array.isArray(results) ? results : [],
                rowCount: Array.isArray(results) ? results.length : 0,
                executionTime: Math.round(executionTime),
                executionId
            };

        } catch (error) {
            const executionTime = performance.now() - startTime;

            this.logger.error('[QueryEngine] Query execution failed', {
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                sourcePath,
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });

            return {
                success: false,
                error: `Query execution failed: ${error.message}`,
                executionTime: Math.round(executionTime),
                executionId,
                data: [],
                rowCount: 0
            };
        }
    }

    /**
     * Validate SQL query for security and compatibility
     */
    private isValidQuery(query: string): boolean {
        const cleanQuery = query.trim().toLowerCase();
        
        // Only allow SELECT queries for security
        if (!cleanQuery.startsWith('select')) {
            return false;
        }

        // Basic SQL injection prevention
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
     * Get current database status and diagnostics
     */
    getStatus(): DatabaseStatus {
        return {
            isInitialized: this.isInitialized,
            isExternalDatabase: this.isExternalDatabase,
            databaseType: this.isExternalDatabase ? 'SQLite (External)' : 'Mock Database',
            hasActiveConnection: !!this.database,
            canExecuteQueries: this.isInitialized && !!this.database
        };
    }

    /**
     * Test database connection with simple query
     */
    async testConnection(): Promise<boolean> {
        try {
            const result = await this.executeQuery('SELECT 1 as test');
            return result.success && result.data?.[0]?.test === 1;
        } catch (error) {
            this.logger.error('[QueryEngine] Connection test failed', { error: error.message });
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
                this.logger.info('[QueryEngine] Database connection closed');
            }
            
            this.database = null;
            this.isInitialized = false;
            this.isExternalDatabase = false;
            
        } catch (error) {
            this.logger.error('[QueryEngine] Cleanup error', { error: error.message });
        }
    }
}

/**
 * Mock SQLite Database for development and fallback
 */
class MockSQLiteDatabase {
    private data: { [tableName: string]: any[] } = {};
    private isInitialized: boolean = false;

    async initialize(): Promise<void> {
        // Create sample data
        this.data.books = [
            { id: 1, name: 'TypeScript Handbook', author: 'Microsoft', year: 2023, rating: 4.8 },
            { id: 2, name: 'Clean Code', author: 'Robert Martin', year: 2021, rating: 4.9 },
            { id: 3, name: 'Design Patterns', author: 'Gang of Four', year: 2022, rating: 4.7 },
            { id: 4, name: 'Refactoring', author: 'Martin Fowler', year: 2023, rating: 4.6 },
            { id: 5, name: 'JavaScript: The Good Parts', author: 'Douglas Crockford', year: 2021, rating: 4.5 }
        ];

        this.data.authors = [
            { id: 1, name: 'Microsoft', country: 'USA', founded: 1975 },
            { id: 2, name: 'Robert Martin', country: 'USA', founded: null },
            { id: 3, name: 'Gang of Four', country: 'Various', founded: null },
            { id: 4, name: 'Martin Fowler', country: 'UK', founded: null },
            { id: 5, name: 'Douglas Crockford', country: 'USA', founded: null }
        ];

        this.isInitialized = true;
    }

    async query(sql: string): Promise<any[]> {
        if (!this.isInitialized) {
            throw new Error('Mock database not initialized');
        }

        const cleanSql = sql.trim().toLowerCase();
        
        // Simple query parser for mock data
        if (cleanSql.includes('select 1 as test')) {
            return [{ test: 1 }];
        }

        if (cleanSql.includes('from books')) {
            let results = [...this.data.books];
            
            // Apply basic WHERE filtering
            if (cleanSql.includes('where')) {
                // Extract simple conditions (very basic parser)
                if (cleanSql.includes('rating >')) {
                    const match = cleanSql.match(/rating\s*>\s*(\d+\.?\d*)/);
                    if (match) {
                        const threshold = parseFloat(match[1]);
                        results = results.filter(book => book.rating > threshold);
                    }
                }
                
                if (cleanSql.includes('year >=')) {
                    const match = cleanSql.match(/year\s*>=\s*(\d+)/);
                    if (match) {
                        const threshold = parseInt(match[1]);
                        results = results.filter(book => book.year >= threshold);
                    }
                }
            }

            // Apply ORDER BY
            if (cleanSql.includes('order by rating desc')) {
                results.sort((a, b) => b.rating - a.rating);
            }

            // Apply LIMIT
            if (cleanSql.includes('limit')) {
                const match = cleanSql.match(/limit\s+(\d+)/);
                if (match) {
                    const limit = parseInt(match[1]);
                    results = results.slice(0, limit);
                }
            }

            return results;
        }

        if (cleanSql.includes('from authors')) {
            return [...this.data.authors];
        }

        // Fallback for unrecognized queries
        throw new Error(`Unsupported query in mock database: ${sql}`);
    }
}

/**
 * Type definitions
 */
interface QueryResult {
    success: boolean;
    data: any[];
    rowCount: number;
    executionTime: number;
    executionId: string;
    error?: string;
}

interface DatabaseStatus {
    isInitialized: boolean;
    isExternalDatabase: boolean;
    databaseType: string;
    hasActiveConnection: boolean;
    canExecuteQueries: boolean;
}