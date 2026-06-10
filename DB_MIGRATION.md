# Moving Database to Hosted Solution

## Overview

This document outlines the approach for moving the local SQLite database to a hosted PostgreSQL solution while maintaining compatibility with the existing application architecture.

## Key Considerations

1. **Application Architecture**: The application currently uses SQLite with SQLCipher encryption in the main process
2. **Database Interface**: All database operations happen through the main process via IPC calls
3. **Data Structure**: The database schema is defined in `src/main/db/migrations/index.ts`
4. **Connection Pattern**: Database connection is lazy-loaded and cached in `connection.ts`

## Implementation Approach

### 1. Environment Configuration

Add these environment variables to your `.env` file:
```
DATABASE_TYPE=postgres
POSTGRES_CONNECTION_STRING=postgresql://username:password@host:port/database_name
```

### 2. Database Schema Migration

The existing schema in `src/main/db/migrations/index.ts` needs to be adapted to PostgreSQL syntax:
- Replace `datetime('now')` with `NOW()`
- Replace `INTEGER PRIMARY KEY AUTOINCREMENT` with `SERIAL PRIMARY KEY`
- Adjust data types as needed for PostgreSQL compatibility

### 3. Key Files to Modify

#### `src/main/db/connection.ts`
- Add logic to switch between SQLite and PostgreSQL based on `DATABASE_TYPE`
- Implement PostgreSQL connection handling
- Maintain the same interface for the rest of the application

#### `src/main/ipc/dataHandlers.ts`
- No changes needed - the IPC interface remains the same
- All database operations will go through the same handlers

### 4. PostgreSQL Adapter Implementation

Create a PostgreSQL adapter that mimics the SQLite Database interface:
- Implement `prepare()` method that returns a statement object with `run()`, `get()`, and `all()` methods
- Implement `exec()` for executing SQL statements
- Implement `transaction()` for transaction handling
- Implement `pragma()` as a no-op (PostgreSQL doesn't use pragmas)

### 5. Migration Strategy

1. **Data Migration**: 
   - Export data from SQLite using existing export functionality
   - Transform data to PostgreSQL format
   - Import into PostgreSQL database

2. **Testing**:
   - Test with a small dataset first
   - Verify all CRUD operations work correctly
   - Ensure data integrity is maintained

### 6. Deployment Considerations

1. **Connection Pooling**: Use connection pooling for better performance
2. **Error Handling**: Implement proper error handling for connection failures
3. **Security**: 
   - Use connection strings with proper authentication
   - Consider SSL/TLS for secure connections
4. **Monitoring**: Add logging for database operations

## Recommended Hosted PostgreSQL Options

1. **Supabase** - Free tier up to 500MB, great tooling
2. **ElephantSQL** - Free tier available, easy setup
3. **AWS RDS** - More robust but requires more setup
4. **Google Cloud SQL** - Managed PostgreSQL service

## Minimal Implementation Steps

1. Add environment variables for database configuration
2. Modify `connection.ts` to support both database types
3. Implement PostgreSQL adapter with minimal interface
4. Create migration script to convert existing data
5. Test thoroughly with existing application functionality