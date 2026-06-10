# Environment Configuration for Supabase

## Required Environment Variables

Add these to your `.env` file:

```
DATABASE_TYPE=postgres
POSTGRES_CONNECTION_STRING=postgresql://postgres:[YOUR-PASSWORD]@db.ahnauivoqhrvzodsaqwq.supabase.co:5432/postgres
```

## Important Notes

1. **Replace [YOUR-PASSWORD]** with your actual Supabase database password
2. **IPv4 Compatibility**: The default connection uses IPv6
3. **For IPv4-only networks**:
   - Enable the IPv4 add-on in Supabase dashboard, OR
   - Use the Session Pooler connection method

## Connection Methods Comparison

| Method | Best For | IPv4 Compatible | Recommended for This App |
|--------|----------|-----------------|--------------------------|
| Direct Connection | Long-lived connections (VMs, containers) | ❌ No | ✅ Yes (if using IPv6 or IPv4 add-on) |
| Session Pooler | Stateless applications (serverless) | ✅ Yes | ⚠️ Only if IPv4-only network |
| Transaction Pooler | High-concurrency applications | ✅ Yes | ❌ No (overkill for inventory app) |

## Recommended Configuration for Your Inventory App

Since this is a desktop Electron application:

1. **Use Direct Connection** (most reliable)
2. **Enable IPv4 add-on** in Supabase if you're on an IPv4-only network
3. **Keep the connection string as-is** for the best performance

## Security Best Practices

- Never commit your `.env` file to version control
- Use Supabase's row-level security for production data
- Consider using a dedicated database user with limited permissions

## Testing the Connection

After setting up the environment variables, test the connection:

```bash
# Build the application
npm run build

# Run the migration to verify connection
npm run migrate:postgres
```

The migration script will verify that the connection to Supabase is working properly.