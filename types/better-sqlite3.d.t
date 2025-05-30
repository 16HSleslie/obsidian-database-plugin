declare module 'better-sqlite3' {
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: any, ...additionalArgs: any[]) => void;
  }

  interface Statement<BindParameters extends any[] = any[]> {
    all(...params: BindParameters): any[];
    get(...params: BindParameters): any;
    run(...params: BindParameters): { changes: number; lastInsertRowid: number };
    iterate(...params: BindParameters): IterableIterator<any>;
    pluck(toggleState?: boolean): this;
    expand(toggleState?: boolean): this;
    raw(toggleState?: boolean): this;
    bind(...params: BindParameters): this;
    columns(): Array<{ name: string; column: string; table?: string; database?: string; type?: string }>;
    busy?: boolean;
    readonly?: boolean;
    source: string;
    reader?: boolean;
  }

  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): this;
    close(): this;
    transaction<T extends any[], R>(fn: (...args: T) => R): (...args: T) => R;
    pragma(pragma: string, options?: { simple?: boolean }): any;
    checkpoint(databaseName?: string): this;
    function(name: string, options: any, fn: (...args: any[]) => any): this;
    function(name: string, fn: (...args: any[]) => any): this;
    aggregate(name: string, options: any): this;
    loadExtension(path: string, entryPoint?: string): this;
    backup(destinationFile: string, options?: { progress?: (info: { totalPages: number; remainingPages: number }) => number }): Promise<void>;
    serialize(options?: { attached?: string }): Buffer;
    readonly inTransaction: boolean;
    readonly open: boolean;
    readonly name: string;
    readonly memory: boolean;
    readonly readonly: boolean;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: DatabaseOptions): Database;
    (filename: string, options?: DatabaseOptions): Database;
  }

  const Database: DatabaseConstructor;
  
  export = Database;
  namespace Database {
    export { DatabaseOptions, Statement, Database as DatabaseInstance };
  }
}