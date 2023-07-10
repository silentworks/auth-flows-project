import { fault, formatError, success } from '$lib/utils';
import { AuthUserEmailSchema } from '$lib/validationSchema';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';
import supabase, { transporter } from '$lib/admin';
import { render } from 'svelte-email';
import Invite from './Invite.svelte';

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
			type: 'invite',
			email
		});

		if (error) {
			return fail(500, fault(error.message, { email }));
		}

		const emailHtml = render({
			template: Invite,
			props: {
				siteUrl: url.origin,
				tokenHash: data.properties.hashed_token
			}
		});

		await transporter.sendMail({
			from: '"Auth Flows App" <foo@example.com>',
			to: `${data.user.email}`,
			subject: 'Your invitation for Auth Flows App',
			html: emailHtml
		});

		return success('Invite was sent successfully to your friend.');
	}
};
