import { fault, formatError, success } from '$lib/utils';
import { ForgotPasswordSchema } from '$lib/validationSchema';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';
import supabase, { transporter } from '$lib/admin';
import Recovery from './Recovery.svelte';
import { render } from 'svelte-email';

export const actions: Actions = {
	default: async ({ request, url }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;

		try {
			ForgotPasswordSchema.parse({ email });
		} catch (err) {
			if (err instanceof ZodError) {
				const errors = formatError(err);
				return fail(400, { errors, email });
			}
		}

		const { data, error } = await supabase.auth.admin.generateLink({
			type: 'recovery',
			email
		});

		if (error) {
			return fail(500, fault('Server error. Try again later.', { email }));
		}

		const emailHtml = render({
			template: Recovery,
			props: {
				siteUrl: url.origin,
				tokenHash: data.properties.hashed_token
			}
		});

		await transporter.sendMail({
			from: '"Auth Flows App" <foo@example.com>',
			to: `${data.user.email}`,
			subject: 'Reset your password for Auth Flows App',
			html: emailHtml
		});

		return success('Please check your email for a password reset link to log into the website.');
	}
};
