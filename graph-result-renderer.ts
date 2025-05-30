import { PluginLogger } from './logger';
import { GraphQueryResult, GraphNode, GraphRelationship } from './neo4j-engine';

/**
 * Graph rendering context for customizing output
 */
export interface GraphRenderContext {
    sourcePath?: string;
    originalQuery?: string;
    showMetadata?: boolean;
    maxRecords?: number;
    renderMode?: 'table' | 'graph' | 'auto';
}

/**
 * Graph Result Renderer - Converts Neo4j query results into HTML for display
 * Handles nodes, relationships, tables, and graph visualizations
 */
export class GraphResultRenderer {
    private logger: PluginLogger;

    constructor(logger: PluginLogger) {
        this.logger = logger.createChildLogger('GraphRenderer');
    }

    /**
     * Render graph query results with appropriate visualization
     * @param result - Graph query result from Neo4j engine
     * @param container - DOM element to render into
     * @param context - Additional rendering context
     */
    async renderGraphResults(result: GraphQueryResult, container: HTMLElement, context?: GraphRenderContext): Promise<void> {
        try {
            this.logger.debug('Rendering graph query results', {
                recordCount: result.summary.recordCount,
                queryType: result.summary.queryType,
                hasGraph: !!result.graph,
                sourcePath: context?.sourcePath
            });

            // Clear the container
            container.empty();

            // Create wrapper for the results
            const wrapper = container.createDiv({
                cls: 'neo4j-query-result'
            });

            // Add metadata header
            if (context?.showMetadata !== false) {
                this.renderGraphMetadata(result, wrapper, context);
            }

            // Determine rendering mode
            const renderMode = this.determineRenderMode(result, context);

            // Render the main content based on mode
            if (result.summary.recordCount === 0) {
                this.renderEmptyResult(wrapper);
            } else {
                switch (renderMode) {
                    case 'graph':
                        await this.renderGraphVisualization(result, wrapper, context);
                        break;
                    case 'table':
                        await this.renderRecordsTable(result, wrapper, context);
                        break;
                    default:
                        // Auto mode - show both if we have graph data
                        if (result.graph && (result.graph.nodes.length > 0 || result.graph.relationships.length > 0)) {
                            await this.renderGraphVisualization(result, wrapper, context);
                            if (this.hasTabularData(result)) {
                                await this.renderRecordsTable(result, wrapper, context);
                            }
                        } else {
                            await this.renderRecordsTable(result, wrapper, context);
                        }
                }
            }

            // Add footer with additional info
            this.renderGraphFooter(result, wrapper, context);

        } catch (error) {
            this.logger.error('Error rendering graph query results', error);
            this.renderGraphError(error, container, context);
        }
    }

    /**
     * Render error messages for graph queries
     */
    renderGraphError(error: Error | unknown, container: HTMLElement, context?: GraphRenderContext): void {
        try {
            container.empty();

            const errorWrapper = container.createDiv({
                cls: 'neo4j-query-error'
            });

            // Error header
            const errorHeader = errorWrapper.createDiv({
                cls: 'neo4j-error-header'
            });
            errorHeader.createSpan({
                cls: 'neo4j-error-icon',
                text: '🔴'
            });
            errorHeader.createSpan({
                cls: 'neo4j-error-title',
                text: 'Cypher Query Error'
            });

            // Error message
            const errorMessage = errorWrapper.createDiv({
                cls: 'neo4j-error-message'
            });
            
            const message = error instanceof Error ? error.message : String(error);
            errorMessage.createDiv({
                cls: 'neo4j-error-text',
                text: message
            });

            // Show original query if available
            if (context?.originalQuery) {
                const querySection = errorWrapper.createDiv({
                    cls: 'neo4j-error-query'
                });
                querySection.createDiv({
                    cls: 'neo4j-error-query-label',
                    text: 'Cypher Query:'
                });
                const queryCode = querySection.createEl('pre', {
                    cls: 'neo4j-error-query-code'
                });
                queryCode.createEl('code', {
                    text: context.originalQuery
                });
            }

            // Add Cypher-specific help
            this.renderCypherErrorHelp(errorWrapper, message);

        } catch (renderError) {
            this.logger.error('Error rendering graph error message', renderError);
            container.empty();
            container.createDiv({
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                cls: 'neo4j-error-fallback'
            });
        }
    }

    /**
     * Render metadata about the graph query execution
     */
    private renderGraphMetadata(result: GraphQueryResult, container: HTMLElement, context?: GraphRenderContext): void {
        const metadata = container.createDiv({
            cls: 'neo4j-query-metadata'
        });

        const metadataItems = [];
        
        metadataItems.push(`${result.summary.recordCount} record${result.summary.recordCount !== 1 ? 's' : ''}`);
        metadataItems.push(`${result.summary.executionTime.toFixed(2)}ms`);
        metadataItems.push(`${result.summary.queryType.toLowerCase()} query`);

        if (result.graph) {
            if (result.graph.nodes.length > 0) {
                metadataItems.push(`${result.graph.nodes.length} node${result.graph.nodes.length !== 1 ? 's' : ''}`);
            }
            if (result.graph.relationships.length > 0) {
                metadataItems.push(`${result.graph.relationships.length} relationship${result.graph.relationships.length !== 1 ? 's' : ''}`);
            }
        }

        if (context?.sourcePath) {
            metadataItems.push(`from ${context.sourcePath}`);
        }

        metadata.createSpan({
            cls: 'neo4j-metadata-text',
            text: metadataItems.join(' • ')
        });
    }

    /**
     * Render graph visualization (nodes and relationships)
     */
    private async renderGraphVisualization(result: GraphQueryResult, container: HTMLElement, context?: GraphRenderContext): Promise<void> {
        if (!result.graph || (result.graph.nodes.length === 0 && result.graph.relationships.length === 0)) {
            return;
        }

        const graphSection = container.createDiv({
            cls: 'neo4j-graph-section'
        });

        const graphHeader = graphSection.createDiv({
            cls: 'neo4j-graph-header'
        });
        graphHeader.createSpan({
            cls: 'neo4j-graph-icon',
            text: '🕸️'
        });
        graphHeader.createSpan({
            cls: 'neo4j-graph-title',
            text: 'Graph Structure'
        });

        // Render nodes
        if (result.graph.nodes.length > 0) {
            this.renderNodes(result.graph.nodes, graphSection);
        }

        // Render relationships
        if (result.graph.relationships.length > 0) {
            this.renderRelationships(result.graph.relationships, result.graph.nodes, graphSection);
        }
    }

    /**
     * Render nodes as cards
     */
    private renderNodes(nodes: GraphNode[], container: HTMLElement): void {
        const nodesSection = container.createDiv({
            cls: 'neo4j-nodes-section'
        });

        const nodesHeader = nodesSection.createDiv({
            cls: 'neo4j-section-header'
        });
        nodesHeader.createSpan({
            text: `Nodes (${nodes.length})`
        });

        const nodesGrid = nodesSection.createDiv({
            cls: 'neo4j-nodes-grid'
        });

        nodes.forEach(node => {
            const nodeCard = nodesGrid.createDiv({
                cls: 'neo4j-node-card'
            });

            // Node header with labels
            const nodeHeader = nodeCard.createDiv({
                cls: 'neo4j-node-header'
            });
            nodeHeader.createSpan({
                cls: 'neo4j-node-id',
                text: `#${node.id}`
            });

            if (node.labels.length > 0) {
                const labelsSpan = nodeHeader.createSpan({
                    cls: 'neo4j-node-labels'
                });
                node.labels.forEach(label => {
                    labelsSpan.createSpan({
                        cls: 'neo4j-node-label',
                        text: label
                    });
                });
            }

            // Node properties
            if (Object.keys(node.properties).length > 0) {
                const propsDiv = nodeCard.createDiv({
                    cls: 'neo4j-node-properties'
                });

                Object.entries(node.properties).forEach(([key, value]) => {
                    const propDiv = propsDiv.createDiv({
                        cls: 'neo4j-property'
                    });
                    propDiv.createSpan({
                        cls: 'neo4j-property-key',
                        text: key + ':'
                    });
                    propDiv.createSpan({
                        cls: 'neo4j-property-value',
                        text: this.formatPropertyValue(value)
                    });
                });
            }
        });
    }

    /**
     * Render relationships as connections
     */
    private renderRelationships(relationships: GraphRelationship[], nodes: GraphNode[], container: HTMLElement): void {
        const relsSection = container.createDiv({
            cls: 'neo4j-relationships-section'
        });

        const relsHeader = relsSection.createDiv({
            cls: 'neo4j-section-header'
        });
        relsHeader.createSpan({
            text: `Relationships (${relationships.length})`
        });

        const relsList = relsSection.createDiv({
            cls: 'neo4j-relationships-list'
        });

        relationships.forEach(rel => {
            const relDiv = relsList.createDiv({
                cls: 'neo4j-relationship'
            });

            // Find start and end nodes
            const startNode = nodes.find(n => n.id === rel.startNodeId);
            const endNode = nodes.find(n => n.id === rel.endNodeId);

            // Relationship visualization
            const relViz = relDiv.createDiv({
                cls: 'neo4j-relationship-viz'
            });

            relViz.createSpan({
                cls: 'neo4j-rel-node',
                text: startNode ? this.getNodeDisplayName(startNode) : rel.startNodeId
            });

            relViz.createSpan({
                cls: 'neo4j-rel-arrow',
                text: '→'
            });

            relViz.createSpan({
                cls: 'neo4j-rel-type',
                text: rel.type
            });

            relViz.createSpan({
                cls: 'neo4j-rel-arrow',
                text: '→'
            });

            relViz.createSpan({
                cls: 'neo4j-rel-node',
                text: endNode ? this.getNodeDisplayName(endNode) : rel.endNodeId
            });

            // Relationship properties
            if (Object.keys(rel.properties).length > 0) {
                const propsDiv = relDiv.createDiv({
                    cls: 'neo4j-relationship-properties'
                });

                Object.entries(rel.properties).forEach(([key, value]) => {
                    const propSpan = propsDiv.createSpan({
                        cls: 'neo4j-rel-property'
                    });
                    propSpan.createSpan({
                        cls: 'neo4j-property-key',
                        text: key + ':'
                    });
                    propSpan.createSpan({
                        cls: 'neo4j-property-value',
                        text: this.formatPropertyValue(value)
                    });
                });
            }
        });
    }

    /**
     * Render records as a table (similar to SQL results)
     */
    private async renderRecordsTable(result: GraphQueryResult, container: HTMLElement, context?: GraphRenderContext): Promise<void> {
        if (result.records.length === 0) return;

        const tableSection = container.createDiv({
            cls: 'neo4j-table-section'
        });

        const tableHeader = tableSection.createDiv({
            cls: 'neo4j-table-header'
        });
        tableHeader.createSpan({
            cls: 'neo4j-table-icon',
            text: '📊'
        });
        tableHeader.createSpan({
            cls: 'neo4j-table-title',
            text: 'Query Results'
        });

        // Create table
        const tableWrapper = tableSection.createDiv({
            cls: 'neo4j-table-wrapper'
        });

        const table = tableWrapper.createEl('table', {
            cls: 'neo4j-result-table'
        });

        // Get column names from first record
        const firstRecord = result.records[0];
        const columns = Object.keys(firstRecord);

        // Render table header
        if (columns.length > 0) {
            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            
            columns.forEach(column => {
                headerRow.createEl('th', {
                    text: column,
                    cls: 'neo4j-table-header-cell'
                });
            });
        }

        // Render table body
        const tbody = table.createEl('tbody');
        const maxRecords = context?.maxRecords || 1000;
        const recordsToShow = Math.min(result.records.length, maxRecords);

        for (let i = 0; i < recordsToShow; i++) {
            const record = result.records[i];
            const tr = tbody.createEl('tr', {
                cls: i % 2 === 0 ? 'neo4j-table-row-even' : 'neo4j-table-row-odd'
            });

            columns.forEach(column => {
                const td = tr.createEl('td', {
                    cls: 'neo4j-table-cell'
                });
                
                this.renderRecordValue(td, record[column]);
            });
        }

        // Show truncation warning if needed
        if (result.records.length > maxRecords) {
            const warning = container.createDiv({
                cls: 'neo4j-truncation-warning'
            });
            warning.createSpan({
                text: `⚠️ Showing first ${maxRecords} of ${result.records.length} records. Use LIMIT clause to control output.`
            });
        }
    }

    /**
     * Render individual record values (nodes, relationships, or primitives)
     */
    private renderRecordValue(container: HTMLElement, value: any): void {
        if (value === null || value === undefined) {
            container.createSpan({
                cls: 'neo4j-cell-null',
                text: 'NULL'
            });
        } else if (this.isGraphNode(value)) {
            // Render node compactly
            const nodeSpan = container.createSpan({
                cls: 'neo4j-cell-node'
            });
            nodeSpan.createSpan({
                cls: 'neo4j-cell-node-labels',
                text: value.labels.join(':')
            });
            nodeSpan.createSpan({
                cls: 'neo4j-cell-node-props',
                text: this.getNodeDisplayName(value)
            });
        } else if (this.isGraphRelationship(value)) {
            // Render relationship compactly
            container.createSpan({
                cls: 'neo4j-cell-relationship',
                text: `[:${value.type}]`
            });
        } else if (typeof value === 'object') {
            // Render object as JSON
            container.createSpan({
                cls: 'neo4j-cell-object',
                text: JSON.stringify(value)
            });
        } else {
            // Render primitive value
            this.renderPrimitiveValue(container, value);
        }
    }

    /**
     * Helper methods
     */
    private determineRenderMode(result: GraphQueryResult, context?: GraphRenderContext): 'table' | 'graph' | 'auto' {
        if (context?.renderMode) return context.renderMode;
        return 'auto'; // Auto-detect based on content
    }

    private hasTabularData(result: GraphQueryResult): boolean {
        return result.records.length > 0 && 
               result.records.some(record => 
                   Object.values(record).some(value => 
                       !this.isGraphNode(value) && !this.isGraphRelationship(value)
                   )
               );
    }

    private isGraphNode(value: any): value is GraphNode {
        return value && typeof value === 'object' && 'id' in value && 'labels' in value && 'properties' in value;
    }

    private isGraphRelationship(value: any): value is GraphRelationship {
        return value && typeof value === 'object' && 'type' in value && 'startNodeId' in value && 'endNodeId' in value;
    }

    private getNodeDisplayName(node: GraphNode): string {
        // Try to find a name-like property
        const nameProps = ['name', 'title', 'label', 'id'];
        for (const prop of nameProps) {
            if (node.properties[prop]) {
                return String(node.properties[prop]);
            }
        }
        return `Node(${node.id})`;
    }

    private formatPropertyValue(value: any): string {
        if (value === null || value === undefined) return 'null';
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    private renderPrimitiveValue(container: HTMLElement, value: any): void {
        if (typeof value === 'number') {
            container.createSpan({
                cls: 'neo4j-cell-number',
                text: value.toString()
            });
        } else if (typeof value === 'boolean') {
            container.createSpan({
                cls: 'neo4j-cell-boolean',
                text: value ? 'true' : 'false'
            });
        } else {
            container.createSpan({
                cls: 'neo4j-cell-text',
                text: String(value)
            });
        }
    }

    private renderEmptyResult(container: HTMLElement): void {
        const emptyDiv = container.createDiv({
            cls: 'neo4j-empty-result'
        });
        
        emptyDiv.createDiv({
            cls: 'neo4j-empty-icon',
            text: '🕸️'
        });
        
        emptyDiv.createDiv({
            cls: 'neo4j-empty-message',
            text: 'Cypher query executed successfully but returned no results.'
        });
    }

    private renderGraphFooter(result: GraphQueryResult, container: HTMLElement, context?: GraphRenderContext): void {
        if (result.context?.executionId) {
            const footer = container.createDiv({
                cls: 'neo4j-query-footer'
            });
            
            footer.createSpan({
                cls: 'neo4j-footer-text',
                text: `Execution ID: ${result.context.executionId}`
            });
        }
    }

    private renderCypherErrorHelp(container: HTMLElement, errorMessage: string): void {
        const suggestions: string[] = [];

        if (errorMessage.toLowerCase().includes('syntax error')) {
            suggestions.push('Check your Cypher syntax. Ensure proper use of parentheses, brackets, and keywords.');
        }
        
        if (errorMessage.toLowerCase().includes('label') && errorMessage.toLowerCase().includes('not found')) {
            suggestions.push('The node label might be incorrect. Use "SHOW LABELS" to see available labels.');
        }
        
        if (errorMessage.toLowerCase().includes('only read')) {
            suggestions.push('Currently only read operations (MATCH, RETURN) are supported. Write operations will be added in future versions.');
        }

        if (errorMessage.toLowerCase().includes('unsupported')) {
            suggestions.push('Try using basic MATCH patterns like "MATCH (n) RETURN n" or "MATCH (p:Person) RETURN p".');
        }

        if (suggestions.length > 0) {
            const helpSection = container.createDiv({
                cls: 'neo4j-error-help'
            });
            
            helpSection.createDiv({
                cls: 'neo4j-help-title',
                text: 'Suggestions:'
            });
            
            const helpList = helpSection.createEl('ul', {
                cls: 'neo4j-help-list'
            });
            
            suggestions.forEach(suggestion => {
                helpList.createEl('li', {
                    cls: 'neo4j-help-item',
                    text: suggestion
                });
            });
        }
    }
}