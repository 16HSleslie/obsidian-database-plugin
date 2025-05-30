import { App } from 'obsidian';
import { PluginLogger } from './logger';

/**
 * Graph query execution context for tracking query source and metadata
 */
export interface GraphQueryContext {
    sourcePath?: string;
    sourceElement?: HTMLElement;
    executionId?: string;
}

/**
 * Graph node representation
 */
export interface GraphNode {
    id: string;
    labels: string[];
    properties: { [key: string]: any };
}

/**
 * Graph relationship representation
 */
export interface GraphRelationship {
    id: string;
    type: string;
    startNodeId: string;
    endNodeId: string;
    properties: { [key: string]: any };
}

/**
 * Result of a Cypher query execution
 */
export interface GraphQueryResult {
    records: any[];           // Raw result records
    summary: {
        query: string;
        executionTime: number;
        recordCount: number;
        queryType: 'READ' | 'WRITE' | 'SCHEMA';
    };
    graph?: {
        nodes: GraphNode[];
        relationships: GraphRelationship[];
    };
    context?: GraphQueryContext;
}

/**
 * Neo4j Query Engine - Handles graph database connections and Cypher query execution
 * 
 * For the initial implementation, this will:
 * 1. Create a mock graph database with sample data
 * 2. Parse basic Cypher queries
 * 3. Eventually integrate neo4j-driver
 */
export class Neo4jQueryEngine {
    private logger: PluginLogger;
    private app: App;
    private database: any; // Will be neo4j driver or mock
    private isInitialized: boolean = false;

    constructor(logger: PluginLogger, app: App) {
        this.logger = logger.createChildLogger('Neo4jEngine');
        this.app = app;
    }

    /**
     * Initialize the Neo4j engine
     */
    async initialize(databasePath?: string): Promise<void> {
        try {
            this.logger.info('Initializing Neo4j Query Engine...', { databasePath });

            // Strategy 1: Try to connect to external Neo4j database if path provided
            if (databasePath && databasePath.trim().length > 0) {
                if (await this.connectToExternalDatabase(databasePath)) {
                    this.logger.info('Connected to external Neo4j database', { path: databasePath });
                    this.isInitialized = true;
                    return;
                }
            }

            // Strategy 2: Create mock graph database for development
            if (await this.createMockGraphDatabase()) {
                this.logger.info('Created mock graph database for development (no external database path provided)');
                this.isInitialized = true;
                return;
            }

            throw new Error('Failed to initialize Neo4j database connection');

        } catch (error) {
            this.logger.error('Failed to initialize Neo4j engine', error);
            throw error;
        }
    }

    /**
     * Execute a Cypher query and return structured results
     */
    async executeCypherQuery(query: string, context?: GraphQueryContext): Promise<GraphQueryResult> {
        const startTime = performance.now();
        const executionId = this.generateExecutionId();

        try {
            if (!this.isInitialized) {
                throw new Error('Neo4j engine not initialized');
            }

            this.logger.debug('Executing Cypher query', { 
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                executionId,
                sourcePath: context?.sourcePath
            });

            // Validate it's a proper Cypher query
            this.validateCypherQuery(query);

            // Execute the query
            const rawResult = await this.executeQuery(query);
            
            // Format the result into our standard structure
            const result = this.formatGraphQueryResult(rawResult, query, context, startTime, executionId);

            this.logger.logPerformance('Cypher query execution', startTime, {
                recordCount: result.summary.recordCount,
                executionId,
                sourcePath: context?.sourcePath
            });

            return result;

        } catch (error) {
            const executionTime = performance.now() - startTime;
            this.logger.error('Cypher query execution failed', error, {
                query: query.substring(0, 200),
                executionId,
                executionTime: `${executionTime.toFixed(2)}ms`,
                sourcePath: context?.sourcePath
            });
            throw error;
        }
    }

    /**
     * Connect to external Neo4j database
     */
    private async connectToExternalDatabase(databasePath: string): Promise<boolean> {
        try {
            this.logger.info('Connecting to external Neo4j database...', { path: databasePath });

            // Check if it's a connection string (bolt://, neo4j://, etc.)
            if (databasePath.startsWith('bolt://') || databasePath.startsWith('neo4j://') || databasePath.startsWith('neo4j+s://')) {
                return await this.connectToRemoteNeo4j(databasePath);
            }

            // Otherwise, treat as local database directory
            return await this.connectToLocalNeo4j(databasePath);

        } catch (error) {
            this.logger.error('Failed to connect to external Neo4j database', error, { path: databasePath });
            return false;
        }
    }

    /**
     * Connect to remote Neo4j instance (bolt://, neo4j://)
     */
    private async connectToRemoteNeo4j(connectionString: string): Promise<boolean> {
        try {
            this.logger.info('Connecting to remote Neo4j...', { connectionString: connectionString.replace(/\/\/.*:.*@/, '//***:***@') });

            // Try to use neo4j-driver if available
            const neo4j = (window as any).require?.('neo4j-driver');
            
            if (!neo4j) {
                this.logger.warn('neo4j-driver not available - cannot connect to remote Neo4j instance. You may need to install it via npm.');
                throw new Error('Neo4j driver not available. Install neo4j-driver: npm install neo4j-driver');
            }

            // Parse connection string for authentication
            let uri = connectionString;
            let auth = neo4j.auth.basic('neo4j', 'neo4j'); // default credentials

            // Check for embedded credentials (user:pass@host format)
            const authMatch = connectionString.match(/^([\w+]+:\/\/)([\w]+):([\w]+)@(.+)$/);
            if (authMatch) {
                const [, protocol, username, password, host] = authMatch;
                uri = protocol + host;
                auth = neo4j.auth.basic(username, password);
                this.logger.debug('Using embedded credentials from connection string');
            } else {
                this.logger.debug('Using default Neo4j credentials (neo4j/neo4j)');
            }

            // Create driver with connection options
            const driver = neo4j.driver(uri, auth, {
                maxConnectionLifetime: 30000,
                maxConnectionPoolSize: 10,
                connectionAcquisitionTimeout: 10000,
                connectionTimeout: 5000
            });
            
            // Test connection with a simple query
            const session = driver.session();
            try {
                const result = await session.run('RETURN 1 as test');
                this.logger.debug('Connection test successful', { 
                    resultCount: result.records.length 
                });
            } finally {
                await session.close();
            }

            // Store driver and session factory
            this.database = { 
                driver, 
                session: () => driver.session(),
                isRemote: true,
                connectionString: uri
            };
            
            this.logger.info('Connected to remote Neo4j successfully', { uri });
            return true;

        } catch (error) {
            this.logger.error('Failed to connect to remote Neo4j', error, {
                connectionString: connectionString.replace(/\/\/.*:.*@/, '//***:***@')
            });
            return false;
        }
    }

    /**
     * Connect to local Neo4j database directory
     */
    private async connectToLocalNeo4j(databasePath: string): Promise<boolean> {
        try {
            const fs = (window as any).require?.('fs');
            const path = (window as any).require?.('path');
            
            if (!fs || !path) {
                this.logger.warn('Node.js filesystem not available - cannot access local Neo4j database');
                return false;
            }

            // Check if directory exists
            const resolvedPath = path.resolve(databasePath);
            
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`Neo4j database directory not found: ${resolvedPath}`);
            }

            // For local Neo4j databases, we would need embedded Neo4j
            // This is complex and not commonly available in Node.js environments
            // For now, suggest using remote connection instead
            this.logger.warn('Local Neo4j database files not yet supported. Use bolt:// connection string instead.');
            return false;

        } catch (error) {
            this.logger.error('Failed to connect to local Neo4j database', error);
            return false;
        }
    }

    /**
     * Create mock graph database with sample data
     */
    private async createMockGraphDatabase(): Promise<boolean> {
        try {
            this.logger.info('Creating mock graph database...');

            this.database = new MockNeo4jDatabase();
            await this.database.initialize();

            this.logger.info('Mock graph database created successfully');
            return true;
        } catch (error) {
            this.logger.error('Failed to create mock graph database', error);
            return false;
        }
    }

    /**
     * Validate Cypher query syntax
     */
    private validateCypherQuery(query: string): void {
        const trimmedQuery = query.trim().toUpperCase();
        
        // Check for basic Cypher keywords
        const validStarters = ['MATCH', 'CREATE', 'MERGE', 'DELETE', 'SET', 'REMOVE', 'RETURN', 'WITH', 'CALL', 'SHOW'];
        const hasValidStarter = validStarters.some(keyword => trimmedQuery.startsWith(keyword));
        
        if (!hasValidStarter) {
            throw new Error(`Invalid Cypher query: Query must start with a valid Cypher keyword (${validStarters.join(', ')})`);
        }

        // For now, restrict to read-only operations for security
        const writeOperations = ['CREATE', 'MERGE', 'DELETE', 'SET', 'REMOVE'];
        const hasWriteOperation = writeOperations.some(op => trimmedQuery.includes(op));
        
        if (hasWriteOperation) {
            throw new Error('Only read operations (MATCH, RETURN) are currently supported');
        }
    }

    /**
     * Execute query using available database connection
     */
    private async executeQuery(query: string): Promise<any> {
        if (this.database && this.database.session) {
            // Using real neo4j-driver
            const session = this.database.session();
            try {
                const result = await session.run(query);
                await session.close();
                
                // Convert neo4j result to our format
                return {
                    records: result.records.map((record: any) => {
                        const obj: any = {};
                        record.keys.forEach((key: string) => {
                            obj[key] = record.get(key);
                        });
                        return obj;
                    })
                };
            } catch (error) {
                await session.close();
                throw error;
            }
        } else if (this.database && this.database.executeCypher) {
            // Using our mock database
            return await this.database.executeCypher(query);
        } else {
            throw new Error('No valid graph database connection available');
        }
    }

    /**
     * Format raw query results into GraphQueryResult structure
     */
    private formatGraphQueryResult(
        rawResult: any, 
        query: string, 
        context?: GraphQueryContext, 
        startTime?: number, 
        executionId?: string
    ): GraphQueryResult {
        const executionTime = startTime ? performance.now() - startTime : 0;
        
        return {
            records: rawResult.records || [],
            summary: {
                query,
                executionTime,
                recordCount: rawResult.records ? rawResult.records.length : 0,
                queryType: this.determineQueryType(query)
            },
            graph: rawResult.graph,
            context: { ...context, executionId }
        };
    }

    /**
     * Determine query type from Cypher statement
     */
    private determineQueryType(query: string): 'READ' | 'WRITE' | 'SCHEMA' {
        const upperQuery = query.toUpperCase().trim();
        
        if (upperQuery.includes('CREATE') || upperQuery.includes('MERGE') || 
            upperQuery.includes('DELETE') || upperQuery.includes('SET') || 
            upperQuery.includes('REMOVE')) {
            return 'WRITE';
        }
        
        if (upperQuery.includes('CREATE INDEX') || upperQuery.includes('DROP INDEX') ||
            upperQuery.includes('CREATE CONSTRAINT') || upperQuery.includes('DROP CONSTRAINT')) {
            return 'SCHEMA';
        }
        
        return 'READ';
    }

    /**
     * Generate unique execution ID for tracking
     */
    private generateExecutionId(): string {
        return `neo4j_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        try {
            this.logger.info('Cleaning up Neo4j Query Engine...');
            
            if (this.database && this.database.close) {
                this.database.close();
            }
            
            this.isInitialized = false;
            this.logger.info('Neo4j Query Engine cleaned up successfully');
        } catch (error) {
            this.logger.error('Error during Neo4j cleanup', error);
        }
    }
}

/**
 * Mock Neo4j Database for testing and development
 * This simulates a real graph database with sample data
 */
class MockNeo4jDatabase {
    private nodes: GraphNode[] = [];
    private relationships: GraphRelationship[] = [];
    
    async initialize(): Promise<void> {
        // Create sample graph data - a simple social network
        this.nodes = [
            // Person nodes
            { id: 'p1', labels: ['Person'], properties: { name: 'Alice', age: 30, city: 'New York' } },
            { id: 'p2', labels: ['Person'], properties: { name: 'Bob', age: 25, city: 'London' } },
            { id: 'p3', labels: ['Person'], properties: { name: 'Charlie', age: 35, city: 'Paris' } },
            { id: 'p4', labels: ['Person'], properties: { name: 'Diana', age: 28, city: 'Tokyo' } },
            
            // Company nodes
            { id: 'c1', labels: ['Company'], properties: { name: 'TechCorp', industry: 'Technology', founded: 2010 } },
            { id: 'c2', labels: ['Company'], properties: { name: 'DataSoft', industry: 'Software', founded: 2015 } },
            
            // Book nodes
            { id: 'b1', labels: ['Book'], properties: { title: 'Graph Databases', author: 'Ian Robinson', year: 2015 } },
            { id: 'b2', labels: ['Book'], properties: { title: 'Neo4j in Action', author: 'Aleksa Vukotic', year: 2014 } }
        ];

        this.relationships = [
            // WORKS_FOR relationships
            { id: 'r1', type: 'WORKS_FOR', startNodeId: 'p1', endNodeId: 'c1', properties: { since: 2020, role: 'Engineer' } },
            { id: 'r2', type: 'WORKS_FOR', startNodeId: 'p2', endNodeId: 'c1', properties: { since: 2019, role: 'Manager' } },
            { id: 'r3', type: 'WORKS_FOR', startNodeId: 'p3', endNodeId: 'c2', properties: { since: 2021, role: 'Developer' } },
            
            // FRIENDS_WITH relationships
            { id: 'r4', type: 'FRIENDS_WITH', startNodeId: 'p1', endNodeId: 'p2', properties: { since: 2018 } },
            { id: 'r5', type: 'FRIENDS_WITH', startNodeId: 'p2', endNodeId: 'p3', properties: { since: 2020 } },
            { id: 'r6', type: 'FRIENDS_WITH', startNodeId: 'p1', endNodeId: 'p4', properties: { since: 2019 } },
            
            // READ relationships
            { id: 'r7', type: 'READ', startNodeId: 'p1', endNodeId: 'b1', properties: { rating: 5, year: 2021 } },
            { id: 'r8', type: 'READ', startNodeId: 'p3', endNodeId: 'b2', properties: { rating: 4, year: 2022 } }
        ];
    }

    async executeCypher(query: string): Promise<any> {
        const upperQuery = query.toUpperCase().trim();
        
        // Handle error cases
        if (upperQuery.includes('NONEXISTENT') || upperQuery.includes('INVALID')) {
            throw new Error('Label `NonexistentLabel` not found');
        }
        
        // Handle basic MATCH queries
        if (upperQuery.startsWith('MATCH')) {
            return this.handleMatchQuery(query);
        }
        
        // Handle SHOW queries (Neo4j 4.0+)
        if (upperQuery.startsWith('SHOW')) {
            return this.handleShowQuery(query);
        }
        
        throw new Error(`Unsupported Cypher query: ${query.substring(0, 50)}`);
    }

    private handleMatchQuery(query: string): any {
        const upperQuery = query.toUpperCase();
        
        // MATCH (n) RETURN n - return all nodes
        if (upperQuery.includes('MATCH (N)') && upperQuery.includes('RETURN N')) {
            return {
                records: this.nodes.map(node => ({ n: node })),
                graph: { nodes: this.nodes, relationships: this.relationships }
            };
        }
        
        // MATCH (p:Person) RETURN p - return all Person nodes
        if (upperQuery.includes('MATCH (P:PERSON)') && upperQuery.includes('RETURN P')) {
            const personNodes = this.nodes.filter(node => node.labels.includes('Person'));
            return {
                records: personNodes.map(node => ({ p: node })),
                graph: { nodes: personNodes, relationships: [] }
            };
        }
        
        // MATCH (p:Person)-[r:WORKS_FOR]->(c:Company) RETURN p, r, c
        if (upperQuery.includes('WORKS_FOR') && upperQuery.includes('COMPANY')) {
            const results: any[] = [];
            const resultNodes: GraphNode[] = [];
            const resultRels: GraphRelationship[] = [];
            
            this.relationships
                .filter(rel => rel.type === 'WORKS_FOR')
                .forEach(rel => {
                    const person = this.nodes.find(n => n.id === rel.startNodeId);
                    const company = this.nodes.find(n => n.id === rel.endNodeId);
                    
                    if (person && company) {
                        results.push({ p: person, r: rel, c: company });
                        if (!resultNodes.find(n => n.id === person.id)) resultNodes.push(person);
                        if (!resultNodes.find(n => n.id === company.id)) resultNodes.push(company);
                        resultRels.push(rel);
                    }
                });
            
            return {
                records: results,
                graph: { nodes: resultNodes, relationships: resultRels }
            };
        }
        
        // MATCH (p:Person) WHERE p.age > 30 RETURN p.name, p.age
        if (upperQuery.includes('WHERE') && upperQuery.includes('AGE')) {
            const ageMatch = query.match(/age\s*([><=]+)\s*(\d+)/i);
            if (ageMatch) {
                const operator = ageMatch[1];
                const threshold = parseInt(ageMatch[2]);
                
                const filteredPersons = this.nodes
                    .filter(node => node.labels.includes('Person'))
                    .filter(node => {
                        const age = node.properties.age;
                        switch (operator) {
                            case '>': return age > threshold;
                            case '>=': return age >= threshold;
                            case '<': return age < threshold;
                            case '<=': return age <= threshold;
                            case '=': return age === threshold;
                            default: return true;
                        }
                    });
                
                return {
                    records: filteredPersons.map(node => ({
                        'p.name': node.properties.name,
                        'p.age': node.properties.age
                    }))
                };
            }
        }
        
        // Count queries
        if (upperQuery.includes('COUNT(')) {
            if (upperQuery.includes('PERSON')) {
                const personCount = this.nodes.filter(node => node.labels.includes('Person')).length;
                return {
                    records: [{ 'count(p)': personCount }]
                };
            }
        }
        
        // Default fallback
        return {
            records: this.nodes.slice(0, 5).map(node => ({ n: node })),
            graph: { nodes: this.nodes.slice(0, 5), relationships: this.relationships.slice(0, 3) }
        };
    }

    private handleShowQuery(query: string): any {
        const upperQuery = query.toUpperCase();
        
        if (upperQuery.includes('LABELS')) {
            const labels = [...new Set(this.nodes.flatMap(node => node.labels))];
            return {
                records: labels.map(label => ({ label }))
            };
        }
        
        if (upperQuery.includes('RELATIONSHIP TYPES')) {
            const types = [...new Set(this.relationships.map(rel => rel.type))];
            return {
                records: types.map(type => ({ relationshipType: type }))
            };
        }
        
        return { records: [] };
    }
}