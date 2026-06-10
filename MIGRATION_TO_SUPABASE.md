# Migrating to Supabase

## Overview

This document describes how to migrate your local SQLite database to Supabase PostgreSQL for hosting.

## Prerequisites

1. **Supabase Account**: Create an account at [supabase.com](https://supabase.com)
2. **Database Instance**: Create a new Supabase project
3. **Connection String**: Get your PostgreSQL connection string from Supabase

## Steps to Migrate

### 1. Set Up Environment Variables

Add the following to your `.env` file:

```env
DATABASE_TYPE=postgres
POSTGRES_CONNECTION_STRING=postgresql://user:password@host:port/database_name
```

### 2. Install Dependencies

```bash
npm install pg @types/pg
```

### 3. Export Current Data

First, run the application with your current SQLite database to ensure all data is saved.

### 4. Run Migration Script

```bash
# Build the application first
npm run build

# Then run the migration
npm run migrate:postgres
```

### 5. Test the Application

Start the application with the PostgreSQL configuration to verify everything works correctly.

## Migration Process Details

The migration process:

1. **Schema Creation**: Creates all tables with the same structure as your SQLite database
2. **Data Transfer**: Copies all data from SQLite to PostgreSQL
3. **Index Creation**: Sets up all necessary indexes for performance
4. **Verification**: Ensures data integrity during transfer

## Supabase Free Tier Benefits

- **$0/month** for the first 500MB database
- 50,000 monthly active users
- 5GB egress
- Community support

This is perfect for your inventory application which will likely stay well under 500MB.

## Notes

- The migration script is designed to be safe and non-destructive
- Always backup your SQLite database before migration
- Test thoroughly in a development environment first
- The application will automatically use PostgreSQL when configured