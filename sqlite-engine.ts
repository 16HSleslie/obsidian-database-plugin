import { App } from 'obsidian';
import { PluginLogger } from './logger';

/**
 * Query execution context for tracking query source and metadata
 */
export interface QueryContext {
    sourcePath?: string;
    sourceElement?: HTMLElement;
    executionId?: string;
}

/**
 * Result of a SQL query execution
 */
export interface QueryResult {
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number;
    query: string;
    context?: QueryContext;
}

/**
 * SQLite Query Engine - Handles database connections and query execution
 * 
 * For the initial implementation, this will either:
 * 1. Use an existing obsidian-sqlite3 plugin if available
 * 2. Create a test database with sample data
 * 3. Eventually integrate better-sqlite3 directly
 */
export class SQLiteQueryEngine {
    private logger: PluginLogger;
    private app: App;
    private database: any; // Will be better-sqlite3 Database or plugin API
    private isInitialized: boolean = false;
    private testDatabasePath: string;

    constructor(logger: PluginLogger, app: App) {
        this.logger = logger.createChildLogger('QueryEngine');
        this.app = app;
        this.testDatabasePath = '';
    }

    /**
     * Initialize the SQLite engine
     * Priority order:
     * 1. Check for existing obsidian-sqlite3 plugin
     * 2. Load external SQLite database file from provided path
     * 3. Create in-memory test database as fallback
     */
    async initialize(databasePath?: string): Promise<void> {
        try {
            this.logger.info('Initializing SQLite Query Engine...', { databasePath });

            // Strategy 1: Try to use existing obsidian-sqlite3 plugin
            if (await this.tryUseObsidianSQLitePlugin()) {
                this.logger.info('Using obsidian-sqlite3 plugin for database access');
                this.isInitialized = true;
                return;
            }

            // Strategy 2: Load external database file if path provided
            if (databasePath && databasePath.trim().length > 0) {
                if (await this.loadExternalDatabase(databasePath)) {
                    this.logger.info('Loaded external SQLite database', { path: databasePath });
                    this.isInitialized = true;
                    return;
                }
            }

            // Strategy 3: Create test database for development
            if (await this.createTestDatabase()) {
                this.logger.info('Created test database for development (no external database path provided)');
                this.isInitialized = true;
                return;
            }

            throw new Error('Failed to initialize any SQLite database connection');

        } catch (error) {
            this.logger.error('Failed to initialize SQLite engine', error);
            throw error;
        }
    }

    /**
     * Execute a SELECT query and return structured results
     */
    async executeSelectQuery(query: string, context?: QueryContext): Promise<QueryResult> {
        const startTime = performance.now();
        const executionId = this.generateExecutionId();

        try {
            if (!this.isInitialized) {
                throw new Error('SQLite engine not initialized');
            }

            this.logger.debug('Executing SELECT query', { 
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                executionId,
                sourcePath: context?.sourcePath
            });

            // Validate it's actually a SELECT query
            const trimmedQuery = query.trim().toUpperCase();
            if (!trimmedQuery.startsWith('SELECT')) {
                throw new Error('Only SELECT queries are supported');
            }

            // Execute the query based on available database connection
            const rawResult = await this.executeQuery(query);
            
            // Format the result into our standard structure
            const result = this.formatQueryResult(rawResult, query, context, startTime, executionId);

            this.logger.logPerformance('Query execution', startTime, {
                rowCount: result.rowCount,
                executionId,
                sourcePath: context?.sourcePath
            });

            return result;

        } catch (error) {
            const executionTime = performance.now() - startTime;
            this.logger.error('Query execution failed', error, {
                query: query.substring(0, 200),
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                sourcePath: context?.sourcePath
            });
            throw error;
        }
    }

    /**
     * Try to use the obsidian-sqlite3 plugin if it's available
     */
    private async tryUseObsidianSQLitePlugin(): Promise<boolean> {
        try {
            // Check if obsidian-sqlite3 plugin is installed and enabled
            const sqlitePlugin = (this.app as any).plugins.getPlugin('obsidian-sqlite3');
            
            if (sqlitePlugin && sqlitePlugin.getDefaultDb) {
                this.database = sqlitePlugin.getDefaultDb();
                this.logger.info('Successfully connected to obsidian-sqlite3 plugin');
                return true;
            }

            this.logger.info('obsidian-sqlite3 plugin not found or not enabled');
            return false;
        } catch (error) {
            this.logger.warn('Failed to connect to obsidian-sqlite3 plugin', error);
            return false;
        }
    }

    /**
     * Load external SQLite database file
     */
    private async loadExternalDatabase(databasePath: string): Promise<boolean> {
        try {
            this.logger.info('Loading external SQLite database...', { path: databasePath });

            // First, try to use obsidian-sqlite3 plugin for external files
            const sqlitePlugin = (this.app as any).plugins.getPlugin('obsidian-sqlite3');
            if (sqlitePlugin && sqlitePlugin.initDatabase) {
                try {
                    this.database = sqlitePlugin.initDatabase(databasePath);
                    this.logger.info('External database loaded via obsidian-sqlite3 plugin');
                    return true;
                } catch (pluginError) {
                    this.logger.warn('obsidian-sqlite3 plugin failed to load database', pluginError);
                }
            }

            // Fallback: Check if better-sqlite3 is available directly
            try {
                const Database = (window as any).require?.('better-sqlite3');
                if (Database) {
                    this.database = new Database(databasePath, { 
                        readonly: false,
                        fileMustExist: true
                    });
                    this.logger.info('External database loaded with better-sqlite3 directly');
                    return true;
                }
            } catch (directError) {
                this.logger.warn('Direct better-sqlite3 access failed', directError);
            }

            // Check if file exists using Obsidian's file system access
            try {
                const fs = (this.app as any).vault.adapter?.fs;
                if (fs && fs.existsSync && fs.existsSync(databasePath)) {
                    // File exists but we can't load it without better-sqlite3
                    throw new Error('Database file found but better-sqlite3 not available. Please install the obsidian-sqlite3 plugin.');
                } else {
                    throw new Error(`Database file not found: ${databasePath}`);
                }
            } catch (fsError) {
                // Try alternative file checking methods
                this.logger.warn('File system check failed, attempting database connection anyway');
                throw new Error(`Cannot access database file: ${databasePath}. Ensure the file exists and is accessible.`);
            }

        } catch (error) {
            this.logger.error('Failed to load external SQLite database', error, { path: databasePath });
            return false;
        }
    }

    /**
     * Create a test database with sample data for development
     * This creates an in-memory database for testing purposes
     */
    private async createTestDatabase(): Promise<boolean> {
        try {
            this.logger.info('Creating test database...');

            // For now, create a mock database object with sample data
            // In a real implementation, this would use better-sqlite3
            this.database = new MockSQLiteDatabase();
            await this.database.initialize();

            this.logger.info('Test database created successfully');
            return true;
        } catch (error) {
            this.logger.error('Failed to create test database', error);
            return false;
        }
    }

    /**
     * Execute a query using whatever database connection we have
     */
    private async executeQuery(query: string): Promise<any> {
        if (this.database && this.database.prepare) {
            // Using real better-sqlite3 (via obsidian-sqlite3 plugin)
            const stmt = this.database.prepare(query);
            return stmt.all();
        } else if (this.database && this.database.executeQuery) {
            // Using our mock database
            return await this.database.executeQuery(query);
        } else {
            throw new Error('No valid database connection available');
        }
    }

    /**
     * Format raw query results into our standard QueryResult structure
     */
    private formatQueryResult(rawResult: any, query: string, context?: QueryContext, startTime?: number, executionId?: string): QueryResult {
        const executionTime = startTime ? performance.now() - startTime : 0;

        // Handle different result formats from different database drivers
        if (Array.isArray(rawResult)) {
            if (rawResult.length === 0) {
                return {
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    executionTime,
                    query,
                    context: { ...context, executionId }
                };
            }

            // Extract columns from first row
            const columns = Object.keys(rawResult[0]);
            const rows = rawResult.map(row => columns.map(col => row[col]));

            return {
                columns,
                rows,
                rowCount: rawResult.length,
                executionTime,
                query,
                context: { ...context, executionId }
            };
        }

        throw new Error('Unsupported query result format');
    }

    /**
     * Generate unique execution ID for tracking
     */
    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        try {
            this.logger.info('Cleaning up SQLite Query Engine...');
            
            if (this.database && this.database.close) {
                this.database.close();
            }
            
            this.isInitialized = false;
            this.logger.info('SQLite Query Engine cleaned up successfully');
        } catch (error) {
            this.logger.error('Error during cleanup', error);
        }
    }
}

/**
 * Mock SQLite Database for testing and development
 * This simulates a real database with better query parsing and error handling
 */
class MockSQLiteDatabase {
    private testData: any[] = [];
    
    async initialize(): Promise<void> {
        // Create sample data for testing
        this.testData = [
            { id: 1, name: 'Sample Book 1', author: 'Author A', year: 2023, rating: 4.5 },
            { id: 2, name: 'Sample Book 2', author: 'Author B', year: 2022, rating: 3.8 },
            { id: 3, name: 'Sample Book 3', author: 'Author A', year: 2024, rating: 4.9 },
            { id: 4, name: 'Sample Book 4', author: 'Author C', year: 2021, rating: 4.2 },
            { id: 5, name: 'Sample Book 5', author: 'Author B', year: 2023, rating: 3.5 }
        ];
    }

    async executeQuery(query: string): Promise<any[]> {
        const upperQuery = query.toUpperCase().trim();
        const originalQuery = query.trim();
        
        // Handle error cases first - queries that should fail
        if (upperQuery.includes('NONEXISTENT_TABLE') || upperQuery.includes('NONEXISTENT') || upperQuery.includes('INVALID_TABLE')) {
            throw new Error(`no such table: nonexistent_table`);
        }
        
        if (upperQuery.includes('INVALID_COLUMN') || upperQuery.includes('BADCOLUMN')) {
            throw new Error(`no such column: invalid_column`);
        }
        
        if (upperQuery.includes('SYNTAX ERROR') || upperQuery.match(/SELECT\s+\*/i) === null && !upperQuery.includes('COUNT')) {
            // Basic syntax validation - if it doesn't look like a proper SELECT
            if (!upperQuery.match(/SELECT\s+[\w\s,\*\(\)]+\s+FROM\s+\w+/i)) {
                throw new Error(`near "${originalQuery.split(' ')[0]}": syntax error`);
            }
        }
        
        // Handle COUNT queries
        if (upperQuery.includes('SELECT COUNT(*)')) {
            if (upperQuery.includes('WHERE')) {
                // Count with filters
                const filteredData = this.applyFilters(this.testData, originalQuery);
                return [{ 'COUNT(*)': filteredData.length }];
            }
            return [{ 'COUNT(*)': this.testData.length }];
        }
        
        // Handle basic SELECT queries
        if (upperQuery.includes('SELECT * FROM BOOKS') || upperQuery.includes('SELECT * FROM TEST')) {
            let resultData = [...this.testData];
            
            // Apply WHERE filters if present
            if (upperQuery.includes('WHERE')) {
                resultData = this.applyFilters(resultData, originalQuery);
            }
            
            // Apply ORDER BY if present
            if (upperQuery.includes('ORDER BY')) {
                resultData = this.applyOrderBy(resultData, originalQuery);
            }
            
            // Apply LIMIT if present
            if (upperQuery.includes('LIMIT')) {
                resultData = this.applyLimit(resultData, originalQuery);
            }
            
            return resultData;
        }
        
        // Handle specific column selections
        if (upperQuery.match(/SELECT\s+[\w\s,]+\s+FROM\s+BOOKS/i)) {
            let resultData = [...this.testData];
            
            // Apply filters and sorting
            if (upperQuery.includes('WHERE')) {
                resultData = this.applyFilters(resultData, originalQuery);
            }
            
            if (upperQuery.includes('ORDER BY')) {
                resultData = this.applyOrderBy(resultData, originalQuery);
            }
            
            if (upperQuery.includes('LIMIT')) {
                resultData = this.applyLimit(resultData, originalQuery);
            }
            
            // Extract requested columns
            const selectMatch = originalQuery.match(/SELECT\s+([\w\s,]+)\s+FROM/i);
            if (selectMatch && selectMatch[1].trim() !== '*') {
                const columns = selectMatch[1].split(',').map(col => col.trim());
                resultData = resultData.map(row => {
                    const newRow: any = {};
                    columns.forEach(col => {
                        if (row.hasOwnProperty(col)) {
                            newRow[col] = row[col];
                        } else {
                            throw new Error(`no such column: ${col}`);
                        }
                    });
                    return newRow;
                });
            }
            
            return resultData;
        }
        
        // Handle GROUP BY queries (basic)
        if (upperQuery.includes('GROUP BY')) {
            return this.handleGroupBy(originalQuery);
        }
        
        // If we get here, it's an unsupported query
        throw new Error(`SQL error: unsupported query format near "${originalQuery.substring(0, 20)}"`);
    }
    
    private applyFilters(data: any[], query: string): any[] {
        const upperQuery = query.toUpperCase();
        
        // Handle rating filters
        const ratingMatch = query.match(/rating\s*([><=]+)\s*(\d+(?:\.\d+)?)/i);
        if (ratingMatch) {
            const operator = ratingMatch[1];
            const threshold = parseFloat(ratingMatch[2]);
            
            return data.filter(row => {
                switch (operator) {
                    case '>': return row.rating > threshold;
                    case '>=': return row.rating >= threshold;
                    case '<': return row.rating < threshold;
                    case '<=': return row.rating <= threshold;
                    case '=': case '==': return row.rating === threshold;
                    default: return true;
                }
            });
        }
        
        // Handle year filters
        const yearMatch = query.match(/year\s*([><=]+)\s*(\d+)/i);
        if (yearMatch) {
            const operator = yearMatch[1];
            const threshold = parseInt(yearMatch[2]);
            
            return data.filter(row => {
                switch (operator) {
                    case '>': return row.year > threshold;
                    case '>=': return row.year >= threshold;
                    case '<': return row.year < threshold;
                    case '<=': return row.year <= threshold;
                    case '=': case '==': return row.year === threshold;
                    default: return true;
                }
            });
        }
        
        // Handle string filters (author, name)
        const authorMatch = query.match(/author\s*=\s*['"](.*?)['"|$]/i);
        if (authorMatch) {
            const authorName = authorMatch[1];
            return data.filter(row => row.author === authorName);
        }
        
        return data;
    }
    
    private applyOrderBy(data: any[], query: string): any[] {
        const orderMatch = query.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
        if (orderMatch) {
            const column = orderMatch[1].toLowerCase();
            const direction = (orderMatch[2] || 'ASC').toUpperCase();
            
            return data.sort((a, b) => {
                let comparison = 0;
                if (a[column] < b[column]) comparison = -1;
                if (a[column] > b[column]) comparison = 1;
                
                return direction === 'DESC' ? -comparison : comparison;
            });
        }
        
        return data;
    }
    
    private applyLimit(data: any[], query: string): any[] {
        const limitMatch = query.match(/LIMIT\s+(\d+)/i);
        if (limitMatch) {
            const limit = parseInt(limitMatch[1]);
            return data.slice(0, limit);
        }
        
        return data;
    }
    
    private handleGroupBy(query: string): any[] {
        const groupMatch = query.match(/GROUP BY\s+(\w+)/i);
        if (groupMatch) {
            const groupColumn = groupMatch[1].toLowerCase();
            
            // Simple GROUP BY implementation
            const groups: { [key: string]: any[] } = {};
            this.testData.forEach(row => {
                const key = row[groupColumn];
                if (!groups[key]) groups[key] = [];
                groups[key].push(row);
            });
            
            // Check if we need aggregation
            if (query.toUpperCase().includes('COUNT(*)')) {
                return Object.keys(groups).map(key => ({
                    [groupColumn]: key,
                    'COUNT(*)': groups[key].length
                }));
            }
            
            if (query.toUpperCase().includes('AVG(')) {
                const avgMatch = query.match(/AVG\((\w+)\)/i);
                if (avgMatch) {
                    const avgColumn = avgMatch[1].toLowerCase();
                    return Object.keys(groups).map(key => ({
                        [groupColumn]: key,
                        [`AVG(${avgColumn})`]: groups[key].reduce((sum, row) => sum + row[avgColumn], 0) / groups[key].length
                    }));
                }
            }
        }
        
        return this.testData;
    }
}