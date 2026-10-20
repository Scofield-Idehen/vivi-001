# Hosting on Firebase and Cloud Run

Staging lives in one Google project: the web app on **Firebase Hosting**, the API and worker on
**Cloud Run** (region `europe-west1`, Belgium, next to the database in Ireland). Hosting forwards
`/v1/**`, `/webhooks/**` and `/health` to the API, so the team uses one address for everything,
`https://<project-id>.web.app`, and the browser never talks across sites. Every push to `main`
deploys (`.github/workflows/deploy.yml`). Migrations are run by hand first, from the **Migrate**
action, whenever a push adds one.

What it costs: nothing, the way it starts. Linking a billing account (needed for Cloud Run) charges
nothing by itself; the API scales to zero when idle and stays inside Cloud Run's free allowance
for a small team (the first click after a quiet spell waits a few seconds); the worker stays on
the laptop until `DEPLOY_WORKER` is set. Always on later: `API_MIN_INSTANCES=1` and
`DEPLOY_WORKER=true` (repository variables), about $25–35 a month together. Set a budget alert
(Billing → Budgets) when linking the card. Hosting is free at this size; the database stays on
Supabase.

## Set-up, once (about half an hour)

You need: owner access to the Firebase project (the Google account Alessio invited), the `gcloud`
and `firebase` command-line tools, and the values from your laptop's `.env` files.

1. **Turn on the Google services** (in the Google Cloud console for the same project, or with
   `gcloud config set project <project-id>` first):

   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com
   gcloud artifacts repositories create v01 --repository-format=docker --location=europe-west1
   ```

2. **A service account for GitHub to deploy with:**

   ```bash
   P=<project-id>
   gcloud iam service-accounts create github-deploy --display-name "GitHub deploy"
   SA=github-deploy@$P.iam.gserviceaccount.com
   for role in roles/run.admin roles/run.viewer roles/artifactregistry.writer roles/iam.serviceAccountUser roles/firebasehosting.admin roles/serviceusage.apiKeysViewer; do
     gcloud projects add-iam-policy-binding $P --member "serviceAccount:$SA" --role $role
   done
   gcloud iam service-accounts keys create github-deploy.json --iam-account $SA
   ```

   `github-deploy.json` is a secret: it goes into GitHub and nowhere else, then delete the file.

3. **GitHub: Settings → Environments → New environment `staging`**, then under it:

   Secrets:
   - `GCP_SERVICE_ACCOUNT`: the whole contents of `github-deploy.json`.
   - `API_ENV`: the API's settings, one `KEY=VALUE` per line, as in `apps/api/.env` on your laptop
     but with `CORS_ORIGINS=https://<project-id>.web.app` and `NODE_ENV=production`. Leave out
     `PORT` and `HOST`.
   - `WORKER_ENV` (only once `DEPLOY_WORKER` is true): the worker's, as in `apps/worker/.env`, with
     `APP_URL=https://<project-id>.web.app` and `NODE_ENV=production`. Leave out `PORT`.

   Variables (under the environment):
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: the same two the web app uses on your laptop
     (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). They are public; variables, not secrets.

4. **Supabase → Authentication → URL Configuration:** Site URL `https://<project-id>.web.app`, and
   add it to the redirect list, or the sign-in email's link will send people back to localhost.

5. **`.firebaserc`:** already set to `vivi-os` (only needed for deploying from a
   laptop; the action takes the id from the variable).

6. **Deploy:** push to `main`, or Actions → Deploy → Run workflow. The first run takes about ten
   minutes (the images are built from scratch). The API's own address is printed at the end;
   nobody needs it, Hosting forwards to it.

7. **Channex webhook:** in Channex, point the webhook at `https://<project-id>.web.app/webhooks/channex`
   with the same secret as `CHANNEX_WEBHOOK_SECRET` in `API_ENV`.

## Day to day

- Push to `main`: a few minutes later the team has it. If the push added a migration, run
  **Migrate** (staging) first; the API refuses nothing, but a page needing the new table fails
  until it is applied.
- The worker's health: `https://<project-id>.web.app` doesn't expose it; in the Cloud Run console
  the `v01-worker` service shows its logs, and Sync health in the console shows its heartbeat.
- Rolling back: Cloud Run keeps every revision; in the console, route traffic to the previous one.
  Hosting keeps releases too (Hosting → Release history → Rollback).
- Settings change: edit the `API_ENV` or `WORKER_ENV` secret and run the Deploy workflow again.
- Production later is the same set-up with a second environment (`production`) and project.
