# Auth flows

This is a SvelteKit/Supabase project showing how to do most of the auth flows.

This project makes use of:

- [Zod](https://zod.dev/) Schema Validation library
- [Supabase Auth Helpers SvelteKit](https://supabase.com/docs/guides/auth/auth-helpers/sveltekit)
- [DaisyUI](https://daisyui.com/)
- [tailwindcss](https://tailwindcss.com/)
- [Playwright](https://playwright.dev/) e2e testing

## Getting started

You can get started with this locally by using the Supabase CLI. Make sure you have the CLI installed before continuing. You can find installation instructions [here](https://supabase.com/docs/guides/cli).

Create a copy of this project using the commands below:

```bash
npx degit silentworks/auth-flows-project project-name
cd project-name
pnpm install
```

You can test the `auth.admin.generateLinks` examples locally using the Supabase CLI or if you decide to use hosted Supabase please replace the SMTP environment variables with information from a mailing server.

If you are using the hosted version please copy the email templates from the `supabase/templates` directory into the Supabase dashboard https://supabase.com/dashboard/project/_/auth/templates

Copy `.env.example` file and rename it `.env`. Now copy the credentials from your dashboard into this file.

Now we can start the project dev server:

```bash
pnpm dev
```

We can now navigate to the `/auth` url to see all the flows.

