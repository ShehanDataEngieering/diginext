# Supabase Session Pooler Configuration

## Overview

Based on your network configuration (IPv4-only), we'll use the Session Pooler connection method for Supabase connectivity.

## Session Pooler Connection String

Use this connection string format instead:

```
postgresql://postgres:[YOUR-PASSWORD]@db.ahnauivoqhrvzodsaqwq.supabase.co:5432/postgres?pooler=1
```

## Configuration Steps

1. **Update your `.env` file**:
   ```
   DATABASE_TYPE=postgres
   POSTGRES_CONNECTION_STRING=postgresql://postgres:[YOUR-PASSWORD]@db.ahnauivoqhrvzodsaqwq.supabase.co:5432/postgres?pooler=1
   ```

2. **Replace [YOUR-PASSWORD]** with your actual Supabase database password

## Session Pooler Benefits for Your Setup

- **IPv4 Compatible**: Works perfectly with your IPv4-only network
- **Connection Management**: Handles connection pooling efficiently
- **Reliability**: More stable for desktop applications on restricted networks
- **Performance**: Optimized for short-lived connections

## Additional Session Pooler Options

You can also customize further with these parameters:
```
postgresql://postgres:[YOUR-PASSWORD]@db.ahnauivoqhrvzodsaqwq.supabase.co:5432/postgres?pooler=1&pool_timeout=30&connect_timeout=10
```

## Testing the Connection

After updating your configuration:

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Run the migration** to verify connection:
   ```bash
   npm run migrate:postgres
   ```

## Network Considerations

Your current network setup shows:
- IPv4 address: 192.168.0.194
- Subnet: 255.255.255.0
- Default gateway: 192.168.0.1

The Session Pooler method will work seamlessly with this configuration.

## Troubleshooting

If you encounter connection issues:

1. Ensure your Supabase project has Session Pooler enabled
2. Check that your firewall allows connections to port 5432
3. Verify your Supabase database password is correct
4. Confirm your network allows outbound connections to Supabase endpoints

## Security Notes

- Keep your connection string secure
- Never commit your `.env` file to version control
- Use a dedicated database user with limited permissions if possible