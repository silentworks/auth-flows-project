import { fault, formatError, success } from '$lib/utils';
import { AuthUserEmailSchema } from '$lib/validationSchema';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';
import supabase, { transporter } from '$lib/admin';
import { render } from 'svelte-email';
import MagicLink from './MagicLink.svelte';

export const actions: Actions = {
	default: async ({ url, request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;

		try {
			AuthUserEmailSchema.parse({ email });
		} catch (err) {
			if (err instanceof ZodError) {
				const errors = formatError(err);
				return fail(400, { errors, email });
			}
		}

		const { data, error } = await supabase.auth.admin.generateLink({
			type: 'magiclink',
			email
		});

		if (error) {
			return fail(500, fault('Server error. Try again later.', { email }));
		}

		const emailHtml = render({
			template: MagicLink,
			props: {
				siteUrl: url.origin,
				tokenHash: data.properties.hashed_token
			}
		});

		await transporter.sendMail({
			from: '"Auth Flows App" <foo@example.com>',
			to: `${data.user.email}`,
			subject: 'Your magic link for Auth Flows App',
			html: emailHtml
		});

		return success('Please check your email for a magic link to log into the website.');
	}
};
