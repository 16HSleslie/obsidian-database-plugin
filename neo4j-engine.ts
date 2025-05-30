import { Logger } from './logger';

/**
 * Neo4j Query Engine with robust dependency handling and fallback mechanisms
 * Handles both external Neo4j connections and mock graph data for development
 */
export class Neo4jQueryEngine {
    private logger: Logger;
    private driver: any = null;
    private session: any = null;
    private isExternalDatabase: boolean = false;
    private isInitialized: boolean = false;
    private mockDatabase: MockGraphDatabase;
    private connectionString?: string;

    constructor(logger: Logger) {
        this.logger = logger;
        this.mockDatabase = new MockGraphDatabase();
    }

    /**
     * Initialize the Neo4j engine with comprehensive dependency checking
     * Falls back gracefully when external dependencies unavailable
     */
    async initialize(connectionString?: string): Promise<boolean> {
        this.logger.info('[Neo4jEngine] Initializing Neo4j Query Engine...', { 
            hasConnectionString: !!connectionString 
        });

        try {
            // Attempt external database connection if connection string provided
            if (connectionString) {
                this.connectionString = connectionString;
                const externalConnected = await this.tryExternalDatabase(connectionString);
                if (externalConnected) {
                    this.logger.info('[Neo4jEngine] External Neo4j database connected successfully');
                    this.isInitialized = true;
                    return true;
                }
            }

            // Fall back to mock database with proper initialization
            return await this.initializeMockDatabase();

        } catch (error) {
            this.logger.error('[Neo4jEngine] Critical initialization error', {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });
            
            // Ensure we always have a working fallback
            return await this.initializeMockDatabase();
        }
    }

    /**
     * Attempt to connect to external Neo4j database with proper error handling
     */
    private async tryExternalDatabase(connectionString: string): Promise<boolean> {
        this.logger.info('[Neo4jEngine] Attempting external Neo4j connection...');

        try {
            // Parse connection string safely
            const connectionInfo = this.parseConnectionString(connectionString);
            if (!connectionInfo) {
                this.logger.error('[Neo4jEngine] Invalid connection string format');
                return false;
            }

            // Try to load neo4j-driver with multiple approaches
            const driver = await this.loadNeo4jDriver();
            if (!driver) {
                this.logger.warn('[Neo4jEngine] Neo4j driver not available, using mock database');
                return false;
            }

            // Create driver instance
            this.driver = driver.driver(
                connectionInfo.uri,
                driver.auth.basic(connectionInfo.username, connectionInfo.password),
                {
                    maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
                    maxConnectionPoolSize: 50,
                    connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
                    disableLosslessIntegers: true
                }
            );

            // Test the connection
            const testResult = await this.testDriverConnection();
            if (testResult) {
                this.isExternalDatabase = true;
                this.logger.info('[Neo4jEngine] External Neo4j connection successful');
                return true;
            }

            // Cleanup failed connection
            await this.cleanupDriver();
            return false;

        } catch (error) {
            this.logger.error('[Neo4jEngine] External database connection failed', {
                errorName: error.name,
                errorMessage: error.message
            });
            await this.cleanupDriver();
            return false;
        }
    }

    /**
     * Parse Neo4j connection string safely
     */
    private parseConnectionString(connectionString: string): ConnectionInfo | null {
        try {
            // Expected format: bolt://username:password@host:port
            const match = connectionString.match(/^(bolt|neo4j):\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/);
            
            if (!match) {
                return null;
            }

            return {
                protocol: match[1],
                username: match[2],
                password: match[3],
                host: match[4],
                port: parseInt(match[5]),
                uri: `${match[1]}://${match[4]}:${match[5]}`
            };

        } catch (error) {
            this.logger.error('[Neo4jEngine] Connection string parsing failed', { error: error.message });
            return null;
        }
    }

    /**
     * Load Neo4j driver with multiple approaches for Electron compatibility
     */
    private async loadNeo4jDriver(): Promise<any> {
        try {
            // Multiple approaches for loading neo4j-driver in Electron environment
            let neo4j;
            
            try {
                // Standard require (may work in some Electron configurations)
                neo4j = require('neo4j-driver');
                this.logger.info('[Neo4jEngine] Loaded neo4j-driver via require');
                return neo4j;
            } catch (requireError) {
                try {
                    // Try dynamic import (modern alternative)
                    neo4j = await import('neo4j-driver');
                    this.logger.info('[Neo4jEngine] Loaded neo4j-driver via import');
                    return neo4j.default || neo4j;
                } catch (importError) {
                    try {
                        // Try Electron-specific loading
                        const { remote } = require('electron');
                        neo4j = remote.require('neo4j-driver');
                        this.logger.info('[Neo4jEngine] Loaded neo4j-driver via electron remote');
                        return neo4j;
                    } catch (electronError) {
                        this.logger.warn('[Neo4jEngine] All neo4j-driver loading methods failed', {
                            requireError: requireError.message,
                            importError: importError.message,
                            electronError: electronError.message
                        });
                        return null;
                    }
                }
            }

        } catch (error) {
            this.logger.error('[Neo4jEngine] Failed to load neo4j-driver', { error: error.message });
            return null;
        }
    }

    /**
     * Test driver connection with timeout
     */
    private async testDriverConnection(): Promise<boolean> {
        try {
            // Create a session and run a simple query
            this.session = this.driver.session();
            const result = await this.session.run('RETURN 1 as test');
            const record = result.records[0];
            
            if (record && record.get('test')?.toNumber?.() === 1 || record.get('test') === 1) {
                this.logger.info('[Neo4jEngine] Driver connection test successful');
                return true;
            }

            return false;

        } catch (error) {
            this.logger.error('[Neo4jEngine] Driver connection test failed', { error: error.message });
            return false;
        } finally {
            // Close test session
            if (this.session) {
                await this.session.close();
                this.session = null;
            }
        }
    }

    /**
     * Initialize mock database with proper error handling
     */
    private async initializeMockDatabase(): Promise<boolean> {
        try {
            this.logger.info('[Neo4jEngine] Initializing mock graph database...');
            
            // Initialize mock database
            await this.mockDatabase.initialize();
            this.isExternalDatabase = false;
            this.isInitialized = true;

            // Test mock database
            const testResult = await this.executeQuery('RETURN 1 as test');
            if (testResult.success) {
                this.logger.info('[Neo4jEngine] Mock graph database initialized successfully');
                return true;
            } else {
                throw new Error('Mock database test query failed');
            }

        } catch (error) {
            this.logger.error('[Neo4jEngine] Mock database initialization failed', {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });
            return false;
        }
    }

    /**
     * Execute Cypher query with comprehensive error handling and performance monitoring
     */
    async executeQuery(query: string, sourcePath?: string): Promise<CypherQueryResult> {
        const executionId = `neo4j_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = performance.now();

        this.logger.info('[Neo4jEngine] Starting Cypher query execution', {
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            executionId,
            sourcePath
        });

        try {
            // Check if engine is initialized
            if (!this.isInitialized) {
                throw new Error('Neo4j engine not initialized. Please check database connection.');
            }

            // Validate query (basic Cypher injection prevention)
            if (!this.isValidCypherQuery(query)) {
                throw new Error('Invalid or potentially unsafe query. Only MATCH and RETURN queries are supported.');
            }

            let results;
            const cleanQuery = query.trim();

            // Execute query based on database type
            if (this.isExternalDatabase && this.driver) {
                results = await this.executeExternalQuery(cleanQuery);
            } else {
                results = await this.mockDatabase.query(cleanQuery);
            }

            const executionTime = performance.now() - startTime;

            this.logger.info('[Neo4jEngine] Cypher query executed successfully', {
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                recordCount: Array.isArray(results) ? results.length : 0,
                sourcePath
            });

            return {
                success: true,
                data: Array.isArray(results) ? results : [],
                recordCount: Array.isArray(results) ? results.length : 0,
                executionTime: Math.round(executionTime),
                executionId
            };

        } catch (error) {
            const executionTime = performance.now() - startTime;

            this.logger.error('[Neo4jEngine] Cypher query execution failed', {
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
                error: `Cypher query execution failed: ${error.message}`,
                executionTime: Math.round(executionTime),
                executionId,
                data: [],
                recordCount: 0
            };
        }
    }

    /**
     * Execute query on external Neo4j database
     */
    private async executeExternalQuery(query: string): Promise<any[]> {
        let session = null;
        
        try {
            session = this.driver.session();
            const result = await session.run(query);
            
            // Convert Neo4j records to plain objects
            return result.records.map((record: any) => {
                const obj: any = {};
                record.keys.forEach((key: string) => {
                    const value = record.get(key);
                    obj[key] = this.convertNeo4jValue(value);
                });
                return obj;
            });

        } finally {
            if (session) {
                await session.close();
            }
        }
    }

    /**
     * Convert Neo4j values to plain JavaScript values
     */
    private convertNeo4jValue(value: any): any {
        if (value === null || value === undefined) {
            return value;
        }

        // Handle Neo4j integers
        if (value.toNumber && typeof value.toNumber === 'function') {
            return value.toNumber();
        }

        // Handle Neo4j nodes
        if (value.properties) {
            return {
                ...value.properties,
                _labels: value.labels,
                _id: value.identity?.toNumber?.() || value.identity
            };
        }

        // Handle Neo4j relationships
        if (value.type && value.start && value.end) {
            return {
                ...value.properties,
                _type: value.type,
                _start: value.start?.toNumber?.() || value.start,
                _end: value.end?.toNumber?.() || value.end,
                _id: value.identity?.toNumber?.() || value.identity
            };
        }

        // Handle arrays
        if (Array.isArray(value)) {
            return value.map(item => this.convertNeo4jValue(item));
        }

        // Handle objects
        if (typeof value === 'object') {
            const converted: any = {};
            for (const [key, val] of Object.entries(value)) {
                converted[key] = this.convertNeo4jValue(val);
            }
            return converted;
        }

        return value;
    }

    /**
     * Validate Cypher query for security and compatibility
     */
    private isValidCypherQuery(query: string): boolean {
        const cleanQuery = query.trim().toLowerCase();
        
        // Only allow read operations for security
        const allowedStarters = ['match', 'return', 'with', 'unwind', 'call'];
        const hasValidStarter = allowedStarters.some(starter => 
            cleanQuery.startsWith(starter) || cleanQuery.includes(`\n${starter}`) || cleanQuery.includes(` ${starter}`)
        );

        if (!hasValidStarter && !cleanQuery.startsWith('return')) {
            return false;
        }

        // Block dangerous operations
        const dangerousPatterns = [
            /\b(create|delete|detach|remove|set|merge)\b/i,
            /\bcall\s+db\./i,
            /\bcall\s+dbms\./i,
            /\bload\s+csv\b/i,
            /\busing\s+periodic\s+commit\b/i
        ];

        return !dangerousPatterns.some(pattern => pattern.test(query));
    }

    /**
     * Get current database status and diagnostics
     */
    getStatus(): Neo4jDatabaseStatus {
        return {
            isInitialized: this.isInitialized,
            isExternalDatabase: this.isExternalDatabase,
            databaseType: this.isExternalDatabase ? 'Neo4j (External)' : 'Mock Graph Database',
            hasActiveConnection: !!this.driver || !!this.mockDatabase,
            canExecuteQueries: this.isInitialized,
            connectionString: this.connectionString ? this.obfuscateConnectionString(this.connectionString) : undefined
        };
    }

    /**
     * Obfuscate connection string for logging
     */
    private obfuscateConnectionString(connectionString: string): string {
        return connectionString.replace(/:([^:@]+)@/, ':***@');
    }

    /**
     * Test database connection with simple query
     */
    async testConnection(): Promise<boolean> {
        try {
            const result = await this.executeQuery('RETURN 1 as test');
            return result.success && result.data?.[0]?.test === 1;
        } catch (error) {
            this.logger.error('[Neo4jEngine] Connection test failed', { error: error.message });
            return false;
        }
    }

    /**
     * Cleanup driver resources
     */
    private async cleanupDriver(): Promise<void> {
        try {
            if (this.session) {
                await this.session.close();
                this.session = null;
            }
            
            if (this.driver) {
                await this.driver.close();
                this.driver = null;
            }
        } catch (error) {
            this.logger.error('[Neo4jEngine] Driver cleanup error', { error: error.message });
        }
    }

    /**
     * Cleanup all resources
     */
    async cleanup(): Promise<void> {
        try {
            await this.cleanupDriver();
            
            this.isInitialized = false;
            this.isExternalDatabase = false;
            this.connectionString = undefined;
            
            this.logger.info('[Neo4jEngine] Cleanup completed');
            
        } catch (error) {
            this.logger.error('[Neo4jEngine] Cleanup error', { error: error.message });
        }
    }
}

/**
 * Mock Graph Database for development and fallback
 */
class MockGraphDatabase {
    private nodes: { [id: string]: any } = {};
    private relationships: any[] = [];
    private isInitialized: boolean = false;

    async initialize(): Promise<void> {
        // Create sample nodes
        this.nodes = {
            'person_1': { 
                id: 'person_1', 
                labels: ['Person'], 
                properties: { name: 'Alice', age: 30, city: 'New York' } 
            },
            'person_2': { 
                id: 'person_2', 
                labels: ['Person'], 
                properties: { name: 'Bob', age: 25, city: 'San Francisco' } 
            },
            'person_3': { 
                id: 'person_3', 
                labels: ['Person'], 
                properties: { name: 'Charlie', age: 35, city: 'Chicago' } 
            },
            'person_4': { 
                id: 'person_4', 
                labels: ['Person'], 
                properties: { name: 'Diana', age: 28, city: 'Seattle' } 
            },
            'company_1': { 
                id: 'company_1', 
                labels: ['Company'], 
                properties: { name: 'TechCorp', industry: 'Technology', founded: 2010 } 
            },
            'company_2': { 
                id: 'company_2', 
                labels: ['Company'], 
                properties: { name: 'DataSoft', industry: 'Software', founded: 2015 } 
            },
            'book_1': { 
                id: 'book_1', 
                labels: ['Book'], 
                properties: { title: 'Graph Databases', author: 'Ian Robinson', year: 2022 } 
            },
            'book_2': { 
                id: 'book_2', 
                labels: ['Book'], 
                properties: { title: 'Neo4j in Action', author: 'Partner et al.', year: 2023 } 
            }
        };

        // Create sample relationships
        this.relationships = [
            { 
                id: 'rel_1', 
                type: 'WORKS_FOR', 
                start: 'person_1', 
                end: 'company_1', 
                properties: { role: 'Engineer', since: 2020 } 
            },
            { 
                id: 'rel_2', 
                type: 'WORKS_FOR', 
                start: 'person_2', 
                end: 'company_1', 
                properties: { role: 'Designer', since: 2021 } 
            },
            { 
                id: 'rel_3', 
                type: 'WORKS_FOR', 
                start: 'person_3', 
                end: 'company_2', 
                properties: { role: 'Manager', since: 2019 } 
            },
            { 
                id: 'rel_4', 
                type: 'FRIENDS_WITH', 
                start: 'person_1', 
                end: 'person_2', 
                properties: { since: 2018 } 
            },
            { 
                id: 'rel_5', 
                type: 'FRIENDS_WITH', 
                start: 'person_2', 
                end: 'person_4', 
                properties: { since: 2020 } 
            },
            { 
                id: 'rel_6', 
                type: 'READ', 
                start: 'person_1', 
                end: 'book_1', 
                properties: { rating: 5, date: '2023-01-15' } 
            },
            { 
                id: 'rel_7', 
                type: 'READ', 
                start: 'person_3', 
                end: 'book_2', 
                properties: { rating: 4, date: '2023-03-20' } 
            }
        ];

        this.isInitialized = true;
    }

    async query(cypher: string): Promise<any[]> {
        if (!this.isInitialized) {
            throw new Error('Mock graph database not initialized');
        }

        const cleanCypher = cypher.trim().toLowerCase();
        
        // Handle simple test queries
        if (cleanCypher.includes('return 1 as test')) {
            return [{ test: 1 }];
        }

        // Handle node queries
        if (cleanCypher.includes('match (p:person)')) {
            const personNodes = Object.values(this.nodes).filter(node => 
                node.labels.includes('Person')
            );

            if (cleanCypher.includes('return p')) {
                return personNodes.map(node => ({
                    p: { ...node.properties, _labels: node.labels, _id: node.id }
                }));
            }

            // Handle property returns
            if (cleanCypher.includes('return p.name')) {
                return personNodes.map(node => ({ 'p.name': node.properties.name }));
            }
        }

        // Handle relationship queries
        if (cleanCypher.includes('works_for')) {
            const results = [];
            
            for (const rel of this.relationships) {
                if (rel.type === 'WORKS_FOR') {
                    const person = this.nodes[rel.start];
                    const company = this.nodes[rel.end];
                    
                    if (person && company) {
                        const result: any = {};
                        
                        if (cleanCypher.includes('p.name')) {
                            result['p.name'] = person.properties.name;
                        }
                        if (cleanCypher.includes('c.name')) {
                            result['c.name'] = company.properties.name;
                        }
                        if (cleanCypher.includes('r.role')) {
                            result['r.role'] = rel.properties.role;
                        }
                        
                        results.push(result);
                    }
                }
            }
            
            return results;
        }

        // Handle FRIENDS_WITH queries
        if (cleanCypher.includes('friends_with')) {
            const results = [];
            
            for (const rel of this.relationships) {
                if (rel.type === 'FRIENDS_WITH') {
                    const person = this.nodes[rel.start];
                    const friend = this.nodes[rel.end];
                    
                    if (person && friend) {
                        results.push({
                            person: person.properties.name,
                            friend: friend.properties.name,
                            since: rel.properties.since
                        });
                    }
                }
            }
            
            return results;
        }

        // Fallback for unrecognized queries
        throw new Error(`Unsupported Cypher query in mock database: ${cypher}`);
    }
}

/**
 * Type definitions
 */
interface CypherQueryResult {
    success: boolean;
    data: any[];
    recordCount: number;
    executionTime: number;
    executionId: string;
    error?: string;
}

interface Neo4jDatabaseStatus {
    isInitialized: boolean;
    isExternalDatabase: boolean;
    databaseType: string;
    hasActiveConnection: boolean;
    canExecuteQueries: boolean;
    connectionString?: string;
}

interface ConnectionInfo {
    protocol: string;
    username: string;
    password: string;
    host: string;
    port: number;
    uri: string;
}