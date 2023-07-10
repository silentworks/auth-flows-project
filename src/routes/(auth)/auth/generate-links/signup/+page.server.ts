import { fault, formatError, success } from '$lib/utils';
import { AuthUserSchema } from '$lib/validationSchema';
import { AuthApiError } from '@supabase/supabase-js';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';
import supabase, { transporter } from '$lib/admin';
import { render } from 'svelte-email';
import Confirmation from './Confirmation.svelte';

export const actions: Actions = {
	default: async ({ url, request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		try {
			AuthUserSchema.parse({ email, password });
		} catch (err) {
			if (err instanceof ZodError) {
				const errors = formatError(err);
				return fail(400, { errors, email });
			}
		}

		const { data, error } = await supabase.auth.admin.generateLink({
			type: 'signup',
			email,
			password
		});

		if (error) {
			if (error instanceof AuthApiError && error.status === 400) {
				return fail(400, fault('Invalid credentials.', { email }));
			}

			return fail(500, fault(error.message, { email }));
		}

		const emailHtml = render({
			template: Confirmation,
			props: {
				siteUrl: url.origin,
				tokenHash: data.properties.hashed_token
			}
		});

		await transporter.sendMail({
			from: '"Auth Flows App" <foo@example.com>',
			to: `${data.user.email}`,
			subject: 'Confirm your email for Auth Flows App',
			html: emailHtml
		});

		return success('Please check your email for a magic link to log into the website.');
	}
};
