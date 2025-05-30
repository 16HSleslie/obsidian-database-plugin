/**
 * Centralized logging system for the Database Plugin
 * Provides structured logging with context and robust error handling
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export interface LogContext {
    [key: string]: any;
}

export class PluginLogger {
    private readonly component: string;
    private readonly vaultName: string;
    private readonly logLevel: LogLevel;

    constructor(component: string, vaultName: string, logLevel: LogLevel = LogLevel.INFO) {
        this.component = component;
        this.vaultName = vaultName;
        this.logLevel = logLevel;
    }

    /**
     * Log debug information - only shown when debug mode is enabled
     */
    debug(message: string, context?: LogContext): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            this.log('DEBUG', message, context);
        }
    }

    /**
     * Log general information
     */
    info(message: string, context?: LogContext): void {
        if (this.logLevel <= LogLevel.INFO) {
            this.log('INFO', message, context);
        }
    }

    /**
     * Log warnings
     */
    warn(message: string, context?: LogContext): void {
        if (this.logLevel <= LogLevel.WARN) {
            this.log('WARN', message, context);
        }
    }

    /**
     * Log errors with full stack traces and context
     */
    error(message: string, error?: Error | unknown, context?: LogContext): void {
        if (this.logLevel <= LogLevel.ERROR) {
            const errorInfo = this.formatError(error);
            this.log('ERROR', message, { ...context, ...errorInfo });
        }
    }

    /**
     * Core logging method with structured output
     */
    private log(level: string, message: string, context?: LogContext): void {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${this.component}] [${level}]`;
        
        if (context && Object.keys(context).length > 0) {
            console.log(`${prefix} ${message}`, context);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    /**
     * Format error objects for logging with maximum information
     */
    private formatError(error: Error | unknown): LogContext {
        if (!error) return {};

        if (error instanceof Error) {
            // Safely access 'cause' property for ES2022+ compatibility
            const errorCause = (error as any).cause || null;
            
            return {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack || 'No stack trace available',
                errorCause: errorCause
            };
        }

        // Handle non-Error objects
        try {
            return {
                errorType: typeof error,
                errorValue: JSON.stringify(error),
                errorString: String(error)
            };
        } catch (jsonError) {
            return {
                errorType: typeof error,
                errorString: String(error),
                jsonSerializationError: 'Could not serialize error object'
            };
        }
    }

    /**
     * Create a child logger with additional context
     */
    createChildLogger(childComponent: string): PluginLogger {
        return new PluginLogger(`${this.component}:${childComponent}`, this.vaultName, this.logLevel);
    }

    /**
     * Log performance metrics
     */
    logPerformance(operation: string, startTime: number, context?: LogContext): void {
        const duration = performance.now() - startTime;
        this.info(`Performance: ${operation}`, {
            ...context,
            duration: `${duration.toFixed(2)}ms`,
            operation
        });
    }

    /**
     * Log database operations specifically
     */
    logDatabaseOperation(operation: string, query: string, params?: any[], rowCount?: number): void {
        this.debug(`Database: ${operation}`, {
            operation,
            query: query.length > 100 ? query.substring(0, 100) + '...' : query,
            paramCount: params?.length || 0,
            rowCount
        });
    }
}