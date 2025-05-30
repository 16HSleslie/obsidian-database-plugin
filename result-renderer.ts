import { PluginLogger } from './logger';
import { QueryResult } from './sqlite-engine';

/**
 * Rendering context for customizing output
 */
export interface RenderContext {
    sourcePath?: string;
    originalQuery?: string;
    showMetadata?: boolean;
    maxRows?: number;
}

/**
 * Query Result Renderer - Converts SQL query results into HTML for display
 * Handles tables, errors, and metadata display similar to DataviewJS
 */
export class QueryResultRenderer {
    private logger: PluginLogger;

    constructor(logger: PluginLogger) {
        this.logger = logger.createChildLogger('ResultRenderer');
    }

    /**
     * Render query results as an HTML table
     * @param result - Query result from SQLite engine
     * @param container - DOM element to render into
     * @param context - Additional rendering context
     */
    async renderResults(result: QueryResult, container: HTMLElement, context?: RenderContext): Promise<void> {
        try {
            this.logger.debug('Rendering query results', {
                rowCount: result.rowCount,
                columnCount: result.columns.length,
                sourcePath: context?.sourcePath
            });

            // Clear the container
            container.empty();

            // Create wrapper for the results
            const wrapper = container.createDiv({
                cls: 'sqlite-query-result'
            });

            // Add metadata header if requested
            if (context?.showMetadata !== false) {
                this.renderMetadata(result, wrapper, context);
            }

            // Render the main table
            if (result.rowCount === 0) {
                this.renderEmptyResult(wrapper);
            } else {
                this.renderTable(result, wrapper, context);
            }

            // Add footer with additional info
            this.renderFooter(result, wrapper, context);

        } catch (error) {
            this.logger.error('Error rendering query results', error);
            this.renderError(error, container, context);
        }
    }

    /**
     * Render error messages in a user-friendly format
     * @param error - Error that occurred
     * @param container - DOM element to render into
     * @param context - Additional context for the error
     */
    renderError(error: Error | unknown, container: HTMLElement, context?: RenderContext): void {
        try {
            // Clear the container
            container.empty();

            const errorWrapper = container.createDiv({
                cls: 'sqlite-query-error'
            });

            // Error header
            const errorHeader = errorWrapper.createDiv({
                cls: 'sqlite-error-header'
            });
            errorHeader.createSpan({
                cls: 'sqlite-error-icon',
                text: '⚠️'
            });
            errorHeader.createSpan({
                cls: 'sqlite-error-title',
                text: 'SQL Query Error'
            });

            // Error message
            const errorMessage = errorWrapper.createDiv({
                cls: 'sqlite-error-message'
            });
            
            const message = error instanceof Error ? error.message : String(error);
            errorMessage.createDiv({
                cls: 'sqlite-error-text',
                text: message
            });

            // Show original query if available
            if (context?.originalQuery) {
                const querySection = errorWrapper.createDiv({
                    cls: 'sqlite-error-query'
                });
                querySection.createDiv({
                    cls: 'sqlite-error-query-label',
                    text: 'Query:'
                });
                const queryCode = querySection.createEl('pre', {
                    cls: 'sqlite-error-query-code'
                });
                queryCode.createEl('code', {
                    text: context.originalQuery
                });
            }

            // Add some helpful tips
            this.renderErrorHelp(errorWrapper, message);

        } catch (renderError) {
            this.logger.error('Error rendering error message', renderError);
            // Fallback: just show plain text
            container.empty();
            container.createDiv({
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                cls: 'sqlite-error-fallback'
            });
        }
    }

    /**
     * Render metadata about the query execution
     */
    private renderMetadata(result: QueryResult, container: HTMLElement, context?: RenderContext): void {
        const metadata = container.createDiv({
            cls: 'sqlite-query-metadata'
        });

        const metadataItems = [];
        
        if (result.rowCount !== undefined) {
            metadataItems.push(`${result.rowCount} row${result.rowCount !== 1 ? 's' : ''}`);
        }
        
        if (result.executionTime) {
            metadataItems.push(`${result.executionTime.toFixed(2)}ms`);
        }

        if (context?.sourcePath) {
            metadataItems.push(`from ${context.sourcePath}`);
        }

        if (metadataItems.length > 0) {
            metadata.createSpan({
                cls: 'sqlite-metadata-text',
                text: metadataItems.join(' • ')
            });
        }
    }

    /**
     * Render results as an HTML table
     */
    private renderTable(result: QueryResult, container: HTMLElement, context?: RenderContext): void {
        const tableWrapper = container.createDiv({
            cls: 'sqlite-table-wrapper'
        });

        const table = tableWrapper.createEl('table', {
            cls: 'sqlite-result-table'
        });

        // Render table header
        if (result.columns.length > 0) {
            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            
            result.columns.forEach(column => {
                headerRow.createEl('th', {
                    text: column,
                    cls: 'sqlite-table-header'
                });
            });
        }

        // Render table body
        const tbody = table.createEl('tbody');
        const maxRows = context?.maxRows || 1000; // Prevent UI freezing with large results
        const rowsToShow = Math.min(result.rows.length, maxRows);

        for (let i = 0; i < rowsToShow; i++) {
            const row = result.rows[i];
            const tr = tbody.createEl('tr', {
                cls: i % 2 === 0 ? 'sqlite-table-row-even' : 'sqlite-table-row-odd'
            });

            row.forEach((cellValue, cellIndex) => {
                const td = tr.createEl('td', {
                    cls: 'sqlite-table-cell'
                });
                
                // Format cell value based on type
                this.renderCellValue(td, cellValue, result.columns[cellIndex]);
            });
        }

        // Show truncation warning if we hit the limit
        if (result.rows.length > maxRows) {
            const warning = container.createDiv({
                cls: 'sqlite-truncation-warning'
            });
            warning.createSpan({
                text: `⚠️ Showing first ${maxRows} of ${result.rows.length} rows. Use LIMIT clause to control output.`
            });
        }
    }

    /**
     * Render individual cell values with appropriate formatting
     */
    private renderCellValue(container: HTMLElement, value: any, columnName: string): void {
        if (value === null || value === undefined) {
            container.createSpan({
                cls: 'sqlite-cell-null',
                text: 'NULL'
            });
        } else if (typeof value === 'number') {
            container.createSpan({
                cls: 'sqlite-cell-number',
                text: value.toString()
            });
        } else if (typeof value === 'boolean') {
            container.createSpan({
                cls: 'sqlite-cell-boolean',
                text: value ? 'true' : 'false'
            });
        } else if (value instanceof Date) {
            container.createSpan({
                cls: 'sqlite-cell-date',
                text: value.toISOString()
            });
        } else {
            // String or other types
            const strValue = String(value);
            
            // Check if it looks like a URL
            if (this.isURL(strValue)) {
                container.createEl('a', {
                    href: strValue,
                    text: strValue,
                    cls: 'sqlite-cell-link'
                });
            } else {
                container.createSpan({
                    cls: 'sqlite-cell-text',
                    text: strValue
                });
            }
        }
    }

    /**
     * Render empty result message
     */
    private renderEmptyResult(container: HTMLElement): void {
        const emptyDiv = container.createDiv({
            cls: 'sqlite-empty-result'
        });
        
        emptyDiv.createDiv({
            cls: 'sqlite-empty-icon',
            text: '📊'
        });
        
        emptyDiv.createDiv({
            cls: 'sqlite-empty-message',
            text: 'Query executed successfully but returned no results.'
        });
    }

    /**
     * Render footer with additional information
     */
    private renderFooter(result: QueryResult, container: HTMLElement, context?: RenderContext): void {
        if (result.context?.executionId) {
            const footer = container.createDiv({
                cls: 'sqlite-query-footer'
            });
            
            footer.createSpan({
                cls: 'sqlite-footer-text',
                text: `Execution ID: ${result.context.executionId}`
            });
        }
    }

    /**
     * Render helpful error messages and suggestions
     */
    private renderErrorHelp(container: HTMLElement, errorMessage: string): void {
        const suggestions: string[] = [];

        // Common error patterns and suggestions
        if (errorMessage.toLowerCase().includes('syntax error')) {
            suggestions.push('Check your SQL syntax. Make sure all keywords are spelled correctly.');
        }
        
        if (errorMessage.toLowerCase().includes('no such table')) {
            suggestions.push('The table name might be incorrect. Use "SELECT name FROM sqlite_master WHERE type=\'table\';" to list available tables.');
        }
        
        if (errorMessage.toLowerCase().includes('no such column')) {
            suggestions.push('The column name might be incorrect. Check the table structure.');
        }
        
        if (errorMessage.toLowerCase().includes('only select')) {
            suggestions.push('Currently only SELECT queries are supported. INSERT, UPDATE, and DELETE will be added in future versions.');
        }

        if (suggestions.length > 0) {
            const helpSection = container.createDiv({
                cls: 'sqlite-error-help'
            });
            
            helpSection.createDiv({
                cls: 'sqlite-help-title',
                text: 'Suggestions:'
            });
            
            const helpList = helpSection.createEl('ul', {
                cls: 'sqlite-help-list'
            });
            
            suggestions.forEach(suggestion => {
                helpList.createEl('li', {
                    cls: 'sqlite-help-item',
                    text: suggestion
                });
            });
        }
    }

    /**
     * Simple URL detection helper
     */
    private isURL(str: string): boolean {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    }
}