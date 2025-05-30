# Obsidian Database Plugin

Execute **SQL and Cypher queries** directly in your Obsidian notes using code blocks. A powerful dual-database plugin supporting both **SQLite (relational)** and **Neo4j (graph)** databases for comprehensive data analysis.

## Features

✅ **Dual Database Support** - Both SQLite and Neo4j in one plugin  
✅ **SQL Code Block Execution** - Write SQL in `sql` or `sqlite` code blocks  
✅ **Cypher Code Block Execution** - Write Cypher in `neo4j` or `cypher` code blocks  
✅ **Rich Result Display** - HTML tables for SQL, graph visualizations for Cypher  
✅ **Robust Error Handling** - Clear error messages with helpful suggestions  
✅ **Performance Monitoring** - Query execution times and result counts  
✅ **Development Ready** - Comprehensive logging and debugging support  

## Quick Start

### SQLite Queries (Relational Data)

````markdown
```sql
SELECT * FROM books WHERE rating > 4.0
```
````

### Neo4j Queries (Graph Data)

````markdown
```cypher
MATCH (p:Person)-[r:WORKS_FOR]->(c:Company)
RETURN p.name, c.name, r.role
```
````

## Usage Examples

### SQLite (Relational Database)

#### Basic Query
````markdown
```sql
SELECT name, author, rating FROM books ORDER BY rating DESC LIMIT 5
```
````

#### Aggregation
````markdown
```sql
SELECT author, COUNT(*) as book_count, AVG(rating) as avg_rating
FROM books 
GROUP BY author 
HAVING book_count > 1
```
````

#### Filtered Results
````markdown
```sql
SELECT * FROM books WHERE year >= 2020 AND rating > 4.0
```
````

### Neo4j (Graph Database)

#### Basic Node Query
````markdown
```cypher
MATCH (p:Person) 
RETURN p.name, p.age, p.city
```
````

#### Relationship Query
````markdown
```cypher
MATCH (p:Person)-[r:FRIENDS_WITH]->(friend:Person)
RETURN p.name as person, friend.name as friend, r.since
```
````

#### Complex Graph Pattern
````markdown
```cypher
MATCH (p:Person)-[:WORKS_FOR]->(c:Company)
WHERE p.age > 25
RETURN c.name, COUNT(p) as employee_count
ORDER BY employee_count DESC
```
````

#### Graph Structure Overview
````markdown
```cypher
MATCH (n)-[r]->(m)
RETURN DISTINCT labels(n) as from_labels, type(r) as relationship, labels(m) as to_labels
```
````

## Current Status

**Phase 1: Dual Database Query Engine** ✅

This release provides core functionality for both databases:

### SQLite Features ✅
- ✅ SQL code block processing (`sql`, `sqlite`)
- ✅ SELECT query execution with filtering, sorting, grouping
- ✅ Table result rendering
- ✅ Mock relational data (books, authors, ratings)

### Neo4j Features ✅
- ✅ Cypher code block processing (`neo4j`, `cypher`)
- ✅ MATCH query execution with patterns and filtering
- ✅ Graph visualization (nodes and relationships)
- ✅ Table result rendering for property queries
- ✅ Mock graph data (people, companies, books, relationships)

**Future Phases:**
- 📋 Real database connections (better-sqlite3, neo4j-driver)
- 📋 Metadata extraction from Markdown files
- 📋 Database building from vault content
- 📋 Advanced SQL/Cypher operations (write operations)
- 📋 Interactive graph visualizations
- 📋 Custom database schemas

## Database Integration

The plugin supports multiple connection strategies for both databases:

### SQLite Integration
1. **Existing obsidian-sqlite3 Plugin** (Recommended)
2. **Test Database** (Development) - Built-in relational sample data
3. **Direct Integration** (Future) - Bundle better-sqlite3 directly

### Neo4j Integration
1. **Test Graph Database** (Development) - Built-in graph sample data
2. **Neo4j Driver Integration** (Future) - Direct connection to Neo4j instances
3. **Embedded Graph Database** (Future) - Local graph storage

## Sample Data

### SQLite Sample Data (Books Database)
- **books** table: id, name, author, year, rating
- Sample authors: Author A, Author B, Author C
- Sample books with ratings from 3.5 to 4.9
- Years from 2021 to 2024

### Neo4j Sample Data (Social Network)
- **Person** nodes: Alice, Bob, Charlie, Diana (with age, city)
- **Company** nodes: TechCorp, DataSoft (with industry, founded)
- **Book** nodes: Graph database books
- **Relationships**: WORKS_FOR, FRIENDS_WITH, READ (with properties)

## Installation

### Development Installation

1. Clone this repository to your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/yourusername/obsidian-database-plugin
   cd obsidian-database-plugin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run dev
   ```

4. Enable the plugin in Obsidian settings

### Manual Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/obsidian-database-plugin/`
3. Reload Obsidian and enable the plugin

## Architecture

### Core Components

- **Main Plugin Class** (`main.ts`) - Dual database plugin lifecycle and code block registration
- **SQLite Query Engine** (`sqlite-engine.ts`) - SQL database connections and query execution
- **Neo4j Query Engine** (`neo4j-engine.ts`) - Graph database connections and Cypher execution
- **SQL Result Renderer** (`result-renderer.ts`) - HTML table generation for relational data
- **Graph Result Renderer** (`graph-result-renderer.ts`) - Graph visualization and table display
- **Logger** (`logger.ts`) - Comprehensive logging and debugging

### Code Block Processing Flow

```
SQLite: ```sql → Parse SQL → Execute Query → Render Table → Display in Note
Neo4j:  ```cypher → Parse Cypher → Execute Query → Render Graph → Display in Note
```

### Supported Code Block Types

- `sql` - SQLite queries
- `sqlite` - SQLite queries (alternative)
- `neo4j` - Neo4j Cypher queries
- `cypher` - Cypher queries (alternative)

## Testing Examples

Create test notes with these query examples:

### SQLite Test Queries

```markdown
# SQLite Basic Tests

## All Books
```sql
SELECT * FROM books
```

## High-Rated Books
```sql
SELECT * FROM books WHERE rating > 4.0 ORDER BY rating DESC
```

## Books by Author
```sql
SELECT author, COUNT(*) as count, AVG(rating) as avg_rating
FROM books GROUP BY author
```

## Error Test
```sql
SELECT * FROM nonexistent_table
```
```

### Neo4j Test Queries

```markdown
# Neo4j Basic Tests

## All People
```cypher
MATCH (p:Person) RETURN p
```

## Work Relationships
```cypher
MATCH (p:Person)-[r:WORKS_FOR]->(c:Company)
RETURN p.name, c.name, r.role
```

## Friend Network
```cypher
MATCH (p:Person)-[r:FRIENDS_WITH]->(friend:Person)
RETURN p.name as person, friend.name as friend
```

## Complex Pattern
```cypher
MATCH (p:Person)-[:WORKS_FOR]->(c:Company)
WHERE p.age > 30
RETURN c.name, COUNT(p) as senior_employees
```

## Error Test
```cypher
MATCH (x:NonexistentLabel) RETURN x
```
```

## Development

### Prerequisites

- Node.js v16+
- TypeScript
- Obsidian development environment

### Building

```bash
# Development build with hot reload
npm run dev

# Production build
npm run build
```

### Project Structure

```
obsidian-database-plugin/
├── main.ts                    # Main plugin class (dual database support)
├── sqlite-engine.ts           # SQLite query engine
├── neo4j-engine.ts           # Neo4j query engine  
├── result-renderer.ts         # SQL result renderer
├── graph-result-renderer.ts   # Graph result renderer
├── logger.ts                  # Logging system
├── styles.css                 # Styling for both SQL tables and graph visualizations
├── manifest.json              # Plugin metadata
└── README.md                  # Documentation
```

### Debugging

The plugin includes comprehensive logging for both databases:
- Set browser console to show all logs
- Check for `[DatabasePlugin]` prefixed messages
- SQLite logs: `[DatabasePlugin:SQLiteEngine]`
- Neo4j logs: `[DatabasePlugin:Neo4jEngine]`
- Error details include stack traces and context

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

Please ensure:
- Code follows TypeScript best practices
- All functions have comprehensive comments
- Error handling is robust for both databases
- Changes are backward compatible

## Roadmap

### Version 0.2.0 - Real Database Connections
- Integrate better-sqlite3 for SQLite
- Integrate neo4j-driver for Neo4j
- Support external database connections

### Version 0.3.0 - Metadata Integration
- Extract frontmatter and tags from vault files
- Build databases from markdown metadata
- Advanced relationship queries

### Version 0.4.0 - Advanced Features
- Interactive graph visualizations
- Custom database schemas
- Data import/export
- Query templates and snippets

### Version 1.0.0 - Production Ready
- Full SQL and Cypher operation support
- Performance optimizations
- Comprehensive documentation

## Known Issues

1. **Database Dependencies**: Currently uses mock data. Real database drivers planned for future versions.

2. **Read-Only Operations**: Currently only SELECT (SQL) and MATCH (Cypher) queries are supported for security.

3. **Large Result Sets**: Results are limited to 1000 rows/records by default to prevent UI freezing.

## License

MIT License - see LICENSE file for details.

---

*Built with ❤️ for the Obsidian community - bridging relational and graph databases*