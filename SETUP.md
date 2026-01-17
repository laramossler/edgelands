# Edgelands Setup Guide

This guide will help you deploy Edgelands from scratch.

## Prerequisites

- Node.js 18+ installed
- A Supabase account
- An Anthropic API key
- An OpenAI API key
- A Twilio account (for SMS)
- A SendGrid account (for email)

## Step 1: Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Go to the SQL Editor in your Supabase dashboard
3. Copy the entire contents of `supabase-schema.sql` and run it
4. Create a Storage bucket named `voice-memos` and make it public:
   - Go to Storage → Create bucket
   - Name: `voice-memos`
   - Public: Yes
5. Get your project credentials:
   - Go to Settings → API
   - Copy the Project URL (NEXT_PUBLIC_SUPABASE_URL)
   - Copy the anon/public key (NEXT_PUBLIC_SUPABASE_ANON_KEY)
   - Copy the service_role key (SUPABASE_SERVICE_ROLE_KEY) - keep this secret!

## Step 2: Create Your User Account

1. In Supabase, go to Authentication → Users
2. Create a new user with your email and password
3. Copy the User ID - you'll need this for DEFAULT_USER_ID

## Step 3: Seed Initial Data (Optional)

You can manually insert data into your tables via the Supabase Table Editor:

### Notification Preferences
```sql
INSERT INTO notification_preferences (user_id, email, phone, sunday_ops_review_time, relationship_nudges_enabled)
VALUES ('your-user-id', 'your@email.com', '+1234567890', '18:00:00', true);
```

### Example Projects
```sql
INSERT INTO projects (user_id, name, state, domain, description)
VALUES
  ('your-user-id', 'Colleagues', 'active', 'colleagues', 'Building the MCP server'),
  ('your-user-id', 'Newsletter', 'active', 'forest', 'Weekly forest insights'),
  ('your-user-id', 'Neural Sanctuary', 'glacier', 'personal', 'On hold for now');
```

### Example Relationships
```sql
INSERT INTO relationships (user_id, name, tier, last_contact_date)
VALUES
  ('your-user-id', 'Haoqing', 1, CURRENT_DATE - INTERVAL '3 days'),
  ('your-user-id', 'Alex', 2, CURRENT_DATE - INTERVAL '10 days');
```

## Step 4: Get API Keys

### Anthropic Claude API
1. Go to https://console.anthropic.com
2. Create an API key
3. Copy the key (starts with `sk-ant-`)

### OpenAI API
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Copy the key (starts with `sk-`)

### Twilio (SMS)
1. Go to https://www.twilio.com/console
2. Get your Account SID and Auth Token
3. Get a phone number from Twilio
4. Format: +1234567890

### SendGrid (Email)
1. Go to https://app.sendgrid.com/settings/api_keys
2. Create a new API key with full access
3. Verify your sender email address in SendGrid

## Step 5: Environment Variables

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in all the values:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
   SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

   ANTHROPIC_API_KEY=sk-ant-xxx...
   OPENAI_API_KEY=sk-xxx...

   TWILIO_ACCOUNT_SID=ACxxx...
   TWILIO_AUTH_TOKEN=xxx...
   TWILIO_PHONE_NUMBER=+1234567890

   SENDGRID_API_KEY=SG.xxx...
   SENDGRID_FROM_EMAIL=edgelands@yourdomain.com

   NEXT_PUBLIC_APP_URL=http://localhost:3000
   DEFAULT_USER_ID=your-supabase-user-id

   CRON_SECRET=generate-a-random-string
   ```

## Step 6: Install Dependencies

```bash
npm install
```

## Step 7: Run Locally

```bash
npm run dev
```

Visit http://localhost:3000

## Step 8: Deploy to Vercel

1. Push your code to GitHub
2. Go to https://vercel.com
3. Import your repository
4. Add all environment variables from your `.env.local`
5. Deploy!

The cron jobs will automatically be set up based on `vercel.json`.

## Step 9: Configure Cron Jobs

The following cron jobs are configured in `vercel.json`:

- **Sunday 6pm**: Ops review notification
- **Daily 9am**: Relationship nudges
- **First of month 6pm**: Monthly pattern analysis

Make sure your `CRON_SECRET` environment variable is set in Vercel for security.

## Usage

### Dashboard (/)
- View current week's energy allocation
- See active projects
- Check relationships needing contact
- Upload voice memos
- Quick log daily energy

### Chat (/chat)
- Full conversational interface with Claude
- Claude has context from your entire database
- Can update projects, log energy, capture insights, etc.

### Voice Memos
Upload or record audio, and it will:
1. Transcribe with Whisper
2. Analyze with Claude
3. Extract insights and tags
4. Store in your integrations

### Energy Logging
Tell Claude (or use quick log):
- "Today was 60% Colleagues, 40% Airbnb"
- Claude will parse and log automatically

### Sunday Ops Review
Every Sunday at 6pm, you'll get an SMS and email to do your weekly review with Claude.

## Troubleshooting

### Voice memos not uploading
- Check that the `voice-memos` bucket exists in Supabase Storage
- Verify the bucket is set to public
- Check browser console for errors

### SMS not working
- Verify Twilio phone number is verified
- Check that your recipient phone number is in E.164 format (+1234567890)
- For Twilio trial accounts, verify the recipient number in Twilio console

### Chat not responding
- Check Anthropic API key is valid
- Check browser console for errors
- Verify Supabase connection

### Cron jobs not running
- Verify cron jobs are enabled in Vercel dashboard
- Check the Logs tab in Vercel for cron execution
- Ensure CRON_SECRET is set correctly

## Next Steps

1. Add more projects and relationships through chat
2. Start logging daily energy
3. Set weekly non-negotiables
4. Upload voice memos for insights

Enjoy your life operating system! 🌲
