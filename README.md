# Friends Included finance system

A fictional wedding guest agency finance application for Dans Stepanovs. The website and Telegram bot share Supabase validation and decision rules. Google Sheets is an automatically updated copy of the database.

## What is included

- Website role selector and role-specific sales or expense forms
- Manager approval of sales and commission splits, and expense allocation
- Dashboard with project and company results, overhead, unallocated expenses, and earned commission
- Telegram submissions, confirmations, and decision notifications
- Two-tab Google Sheets copy with stable row numbers and retryable synchronization
- Supabase schema with transaction validation, unique references, and atomic decisions

## Service setup

1. Create a Supabase project. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor. Copy the project URL and **server-only secret key** to `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
2. Create a Google Cloud project and enable the Google Sheets API. Create a service account and download its JSON key. Create a **new, dedicated** Google spreadsheet and share it with the service account email as **Editor**. Put the spreadsheet ID in `GOOGLE_SHEET_ID` and the entire JSON key in `GOOGLE_SERVICE_ACCOUNT_JSON`. Give the instructor **Viewer** access to the spreadsheet. The app creates and formats Sales and Expenses tabs when the first transaction syncs.
3. Create a Telegram bot with `@BotFather`. Put its token in `TELEGRAM_BOT_TOKEN` and its username, without the `@`, in `TELEGRAM_BOT_USERNAME`. Generate a random private value for `TELEGRAM_WEBHOOK_SECRET` using only letters, digits, `_`, and `-`.
4. Push this folder to a GitHub repository. Connect it to Vercel. Set the same environment variables in Vercel, plus `STUDENT_NAME=Dans Stepanovs`, `GITHUB_REPO_URL`, and `APP_BASE_URL` as the final public `https://...vercel.app` URL. Redeploy after changing variables.
5. On the published site select Svetlana and choose **Connect Telegram webhook**. Open the bot link and send `/start` in a private Telegram chat. The manager screen will show your Telegram user ID. Link it to Richard before entering S01.

Never put tokens, passwords, the service-account JSON, or `.env` files in GitHub, Sheets, or the website. The role selector is intentionally a fictional demonstration interface, not an identity system for real financial data.

## Local development

Copy `.env.example` to `.env.local` and fill in the values. Then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Telegram requires a public HTTPS URL, so its webhook is configured on the deployed Vercel site.

## Telegram commands

First send `/start`. The website manager must link the resulting Telegram user ID to a fictional employee. Unlinked users cannot submit, and the bot cannot assign a role.

```text
/sale | S01 | Olivia Rose | A | One proud uncle and an emotional grandmother | 1000 | 50/30/20
/expense | E01 | Rented suit and fake pearl necklace for the relatives | Materials | 120 | A
```

Use `A`, `B`, or `Company overhead` for expense allocation. Use `/help` to see these formats in Telegram. For the assignment's first two bot entries, link your ID to Richard, send S01, then change the link to Kevin and send E01. Their original submitters and chat destinations stay saved.

## Assignment verification

Run `node scripts/verify.mjs` for the supplied Test 1 and Test 2 totals and rounding check. In the deployed application, enter the remaining supplied transactions through the role selector, perform Svetlana's prescribed decisions, and inspect the actual Sales and Expenses tabs. Test invalid splits, missing or zero amounts, duplicate references, role restrictions, and repeated approvals. A Sheets failure leaves the transaction saved with a retry option; a Telegram failure leaves the decision saved with a retry option.

The application intentionally does not seed or hard-code the test transactions. Keep S05 pending and E07 awaiting allocation at submission. The instructor can enter further fictional transactions, and totals will update.
