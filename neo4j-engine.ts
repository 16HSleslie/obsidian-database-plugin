import { PluginLogger } from './logger';

/**
 * Neo4j Query Engine - External databases only
 * No mock data - only connects to real Neo4j databases
 */
export class Neo4jQueryEngine {
    private logger: PluginLogger;
    private driver: any = null;
    private session: any = null;
    private isExternalDatabase: boolean = false;
    private isInitialized: boolean = false;
    private connectionString?: string;

    constructor(logger: PluginLogger) {
        this.logger = logger;
    }

    /**
     * Initialize the Neo4j engine - external database only
     */
    async initialize(connectionString?: string): Promise<boolean> {
        this.logger.info('Initializing Neo4j Query Engine...', { 
            hasConnectionString: !!connectionString 
        });

        if (!connectionString) {
            this.logger.warn('No connection string provided - Neo4j engine will not be available');
            return false;
        }

        try {
            this.connectionString = connectionString;
            const connected = await this.tryExternalDatabase(connectionString);
            if (connected) {
                this.logger.info('External Neo4j database connected successfully');
                this.isInitialized = true;
                return true;
            }

            this.logger.error('Failed to connect to external Neo4j database');
            return false;

        } catch (error) {
            this.logger.error('Critical initialization error', error, {
                connectionString: connectionString ? this.obfuscateConnectionString(connectionString) : undefined
            });
            return false;
        }
    }

    /**
     * Attempt to connect to external Neo4j database
     */
    private async tryExternalDatabase(connectionString: string): Promise<boolean> {
        this.logger.info('Attempting external Neo4j connection...');

        try {
            // Parse connection string safely
            const connectionInfo = this.parseConnectionString(connectionString);
            if (!connectionInfo) {
                this.logger.error('Invalid connection string format', {
                    expectedFormat: 'bolt://username:password@host:port',
                    example: 'bolt://neo4j:password@localhost:7687'
                });
                return false;
            }

            // Try to load neo4j-driver
            const driver = await this.loadNeo4jDriver();
            if (!driver) {
                this.logger.error('Neo4j driver not available', {
                    reason: 'neo4j-driver module not available in current environment'
                });
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
                this.logger.info('External Neo4j connection successful');
                return true;
            }

            // Cleanup failed connection
            await this.cleanupDriver();
            return false;

        } catch (error) {
            this.logger.error('External database connection failed', error);
            await this.cleanupDriver();
            return false;
        }
    }

    /**
     * Parse Neo4j connection string
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
            this.logger.error('Connection string parsing failed', error);
            return null;
        }
    }

    /**
     * Load Neo4j driver
     */
    private async loadNeo4jDriver(): Promise<any> {
        try {
            this.logger.info('Attempting to load neo4j-driver...');
            
            let neo4j;
            
            try {
                neo4j = require('neo4j-driver');
                this.logger.info('Loaded neo4j-driver via require');
                return neo4j;
            } catch (requireError) {
                this.logger.warn('neo4j-driver require failed', { error: requireError.message });
                
                try {
                    neo4j = await import('neo4j-driver');
                    this.logger.info('Loaded neo4j-driver via import');
                    return (neo4j as any).default || neo4j;
                } catch (importError) {
                    this.logger.warn('neo4j-driver import failed', { error: importError.message });
                    
                    try {
                        const { remote } = require('electron');
                        neo4j = remote.require('neo4j-driver');
                        this.logger.info('Loaded neo4j-driver via electron remote');
                        return neo4j;
                    } catch (electronError) {
                        this.logger.error('All neo4j-driver loading methods failed', {
                            requireError: requireError.message,
                            importError: importError.message,
                            electronError: electronError.message
                        });
                        return null;
                    }
                }
            }

        } catch (error) {
            this.logger.error('Failed to load neo4j-driver', error);
            return null;
        }
    }

    /**
     * Test driver connection
     */
    private async testDriverConnection(): Promise<boolean> {
        try {
            this.session = this.driver.session();
            const result = await this.session.run('RETURN 1 as test');
            const record = result.records[0];
            
            if (record && record.get('test')?.toNumber?.() === 1 || record.get('test') === 1) {
                this.logger.info('Driver connection test successful');
                return true;
            }

            return false;

        } catch (error) {
            this.logger.error('Driver connection test failed', error);
            return false;
        } finally {
            if (this.session) {
                await this.session.close();
                this.session = null;
            }
        }
    }

    /**
     * Execute Cypher query - external database only
     */
    async executeQuery(query: string, sourcePath?: string): Promise<GraphQueryResult> {
        const executionId = `neo4j_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = performance.now();

        this.logger.info('Starting Cypher query execution', {
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            executionId,
            sourcePath
        });

        try {
            // Check if engine is initialized
            if (!this.isInitialized || !this.driver) {
                throw new Error('Neo4j engine not initialized. No external database connection available.');
            }

            // Validate query
            if (!this.isValidCypherQuery(query)) {
                throw new Error('Invalid or potentially unsafe query. Only MATCH and RETURN queries are supported.');
            }

            const cleanQuery = query.trim();
            const results = await this.executeExternalQuery(cleanQuery);
            const executionTime = performance.now() - startTime;

            this.logger.info('Cypher query executed successfully', {
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                recordCount: Array.isArray(results) ? results.length : 0,
                sourcePath
            });

            // Transform results for graph visualization
            const transformedResults = this.transformGraphResults(results);

            return {
                success: true,
                records: transformedResults.records,
                graph: transformedResults.graph,
                summary: {
                    recordCount: transformedResults.records.length,
                    executionTime: Math.round(executionTime),
                    queryType: this.detectQueryType(cleanQuery)
                },
                context: {
                    executionId
                }
            };

        } catch (error) {
            const executionTime = performance.now() - startTime;

            this.logger.error('Cypher query execution failed', error, {
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                sourcePath
            });

            return {
                success: false,
                error: `Cypher query execution failed: ${error.message}`,
                records: [],
                graph: null,
                summary: {
                    recordCount: 0,
                    executionTime: Math.round(executionTime),
                    queryType: this.detectQueryType(query)
                },
                context: {
                    executionId
                }
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
     * Transform query results into graph visualization format
     */
    private transformGraphResults(results: any[]): { records: any[], graph: GraphData | null } {
        if (!Array.isArray(results) || results.length === 0) {
            return { records: [], graph: null };
        }

        const nodes: GraphNode[] = [];
        const relationships: GraphRelationship[] = [];
        const records = [...results];

        // Extract nodes and relationships from results
        for (const record of results) {
            for (const [key, value] of Object.entries(record)) {
                if (this.isGraphNode(value)) {
                    const node = value as GraphNode;
                    if (!nodes.find(n => n.id === node.id)) {
                        nodes.push(node);
                    }
                } else if (this.isGraphRelationship(value)) {
                    const rel = value as GraphRelationship;
                    if (!relationships.find(r => r.id === rel.id)) {
                        relationships.push(rel);
                    }
                }
            }
        }

        const graph: GraphData | null = (nodes.length > 0 || relationships.length > 0) ? {
            nodes,
            relationships
        } : null;

        return { records, graph };
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
                id: value.identity?.toNumber?.() || value.identity,
                labels: value.labels || [],
                properties: value.properties
            };
        }

        // Handle Neo4j relationships
        if (value.type && value.start && value.end) {
            return {
                id: value.identity?.toNumber?.() || value.identity,
                type: value.type,
                startNodeId: value.start?.toNumber?.() || value.start,
                endNodeId: value.end?.toNumber?.() || value.end,
                properties: value.properties || {}
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
     * Helper methods
     */
    private detectQueryType(query: string): string {
        const cleanQuery = query.trim().toLowerCase();
        if (cleanQuery.startsWith('match')) return 'READ';
        if (cleanQuery.startsWith('create')) return 'WRITE';
        if (cleanQuery.startsWith('return')) return 'READ';
        if (cleanQuery.startsWith('merge')) return 'WRITE';
        return 'UNKNOWN';
    }

    private isGraphNode(value: any): boolean {
        return value && typeof value === 'object' && 'id' in value && 'labels' in value && 'properties' in value;
    }

    private isGraphRelationship(value: any): boolean {
        return value && typeof value === 'object' && 'type' in value && 'startNodeId' in value && 'endNodeId' in value;
    }

    /**
     * Validate Cypher query for security
     */
    private isValidCypherQuery(query: string): boolean {
        const cleanQuery = query.trim().toLowerCase();
        
        const allowedStarters = ['match', 'return', 'with', 'unwind', 'call'];
        const hasValidStarter = allowedStarters.some(starter => 
            cleanQuery.startsWith(starter) || cleanQuery.includes(`\n${starter}`) || cleanQuery.includes(` ${starter}`)
        );

        if (!hasValidStarter && !cleanQuery.startsWith('return')) {
            return false;
        }

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
     * Get database status
     */
    getStatus(): Neo4jDatabaseStatus {
        return {
            isInitialized: this.isInitialized,
            isExternalDatabase: this.isExternalDatabase,
            databaseType: this.isExternalDatabase ? 'Neo4j (External)' : 'Not Connected',
            hasActiveConnection: !!this.driver,
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
     * Test database connection
     */
    async testConnection(): Promise<boolean> {
        try {
            if (!this.isInitialized || !this.driver) {
                return false;
            }
            
            const result = await this.executeQuery('RETURN 1 as test');
            return result.success && result.records?.[0]?.test === 1;
        } catch (error) {
            this.logger.error('Connection test failed', error);
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
            this.logger.error('Driver cleanup error', error);
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
            
            this.logger.info('Cleanup completed');
            
        } catch (error) {
            this.logger.error('Cleanup error', error);
        }
    }
}

/**
 * Type definitions
 */
export interface GraphQueryResult {
    success: boolean;
    records: any[];
    graph?: GraphData | null;
    summary: {
        recordCount: number;
        executionTime: number;
        queryType: string;
    };
    context?: {
        executionId: string;
    };
    error?: string;
}

export interface GraphData {
    nodes: GraphNode[];
    relationships: GraphRelationship[];
}

export interface GraphNode {
    id: string;
    labels: string[];
    properties: { [key: string]: any };
}

export interface GraphRelationship {
    id: string;
    type: string;
    startNodeId: string;
    endNodeId: string;
    properties: { [key: string]: any };
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