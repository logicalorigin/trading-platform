# Replit Support Request — Historical Security-Sensitive Copies

Status: prepared and secret-free; not submitted. Submission requires explicit
user authorization through an authenticated Replit support channel.

## Suggested subject

Security retention/deletion request: historical Git object and checkpoint
database copies

## Ready-to-send message

Hello Replit Support,

We are preparing a private Replit App for publication and need written
retention/deletion guidance for two security-sensitive historical data sets.

1. A retired third-party bridge credential was removed from the current
   working tree. Our local repository shows that main and the locally cached
   origin/main do not contain the affected commit. Four direct non-main local
   refs plus one symbolic alias still retain it; we have rehearsed their
   coordinated rewrite but have not yet changed them while collaborators are
   active.
2. A database column that retained raw brokerage statement XML was removed.
   The migration preserved all 54 normalized audit rows while deleting
   approximately 137 MB of raw source XML from the live database.

We have deliberately excluded the credential value and raw XML from this
request. Through this authenticated ticket we can provide the private Replit
App identifier, the non-secret Git commit and blob OIDs, the historical file
path, and the database migration timestamp.

Current Replit documentation states that Agent checkpoints can preserve
project files, AI conversation context, environment configuration, Agent
memory, and connected database contents. Replit Pro documentation describes a
28-day database recovery window instead of the standard seven days. The
documentation we found does not identify a retention period or per-checkpoint
deletion control for every development checkpoint or provider backup class.

Please confirm specifically for this Replit App:

1. Every Replit-managed copy class that can retain the historical Git object,
   checkpoint project file, Agent conversation/context copy, environment
   configuration, file history, development database snapshot, or production
   database recovery image.
2. The retention period for each copy class and whether expiration is measured
   from creation, dereference/deletion, checkpoint replacement, or another
   event.
3. Whether individual Agent checkpoints and their project/database snapshots
   can be permanently deleted without deleting the Replit App or account.
4. Whether Git/checkpoint/disaster-recovery systems can retain an object after
   every live Git ref has been rewritten or deleted, and what action starts its
   retention clock.
5. Whether development or production database recovery copies can be purged
   earlier than their normal window for a security/privacy incident.
6. Whether restoring any surviving checkpoint or backup after cleanup could
   rehydrate the removed credential file or raw XML column.
7. What written evidence Replit can provide after deletion or expiry, including
   the ticket ID, copy classes covered, deletion or terminal-expiry timestamp,
   and any excluded systems.

Please treat this as a security/privacy retention request. Please do not
restore, open, or inspect the sensitive values unless strictly required and
agreed through this ticket. We will never send the credential value or raw XML.
If project-specific security details are needed, please keep them inside the
authenticated ticket rather than ordinary email.

Thank you.

## Official documentation verified on 2026-07-21

- Checkpoints and rollbacks:
  https://docs.replit.com/references/version-control/checkpoints-and-rollbacks
- Replit Pro recovery window:
  https://docs.replit.com/billing/plans/replit-pro
- Deleting your data:
  https://docs.replit.com/legal-and-security-info/deleting-your-data
- Authenticated support entry point:
  https://replit.com/support

## Before sending

- Confirm the local Git rewrite has either completed or update the status
  paragraph to match the exact current state.
- Add the private Replit App URL or project ID only through the authenticated
  support form.
- Include the affected commit and blob OIDs and historical file path, but never
  paste the credential value.
- Add the exact UTC database migration time if it is available from the
  production migration log; otherwise label it unknown.
- Request a ticket identifier and keep the response evidence in
  .local/security-results/replit-historical-copy-deletion-response-template-20260721.md.
