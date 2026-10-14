# V-01 staff

V-01 staff use the console. They are separate from every operator's team, and adding someone here
gives them no access to any operator's data on its own.

| Role | Console totals and statuses | Operators' team names and emails | Open support access |
| --- | --- | --- | --- |
| owner | yes | yes | yes, and can end anyone's |
| support | yes | yes | yes |
| viewer | yes | no | no |

From a trusted machine, with `DATABASE_OWNER_URL` set to the direct owner connection:

```bash
pnpm db:staff list
pnpm db:staff add someone@example.com owner
pnpm db:staff add helpdesk@example.com support
pnpm db:staff remove helpdesk@example.com     # also closes any support access they have open
```

Someone added by email becomes staff the first time they sign in with that email (or straight away,
if they have signed in before).

## Support access

To look inside an operator's workspace, open the operator in the console and choose
**Open with support access**. Give a reason the operator can read, and a length of time (up to four
hours). The workspace opens read-only, with a banner showing when access ends.

- Every request is logged, including refused ones, and counted on the Support log.
- The operator sees each visit (who, why, when, how long) on their Workspace page.
- Access closes by itself at its end time, when you choose **End access**, or at once if you are
  removed from staff.
- Support access never lets anyone change an operator's data. Changes are made by the operator's own
  team, or by V-01 through a migration or script that is reviewed like any other code.
