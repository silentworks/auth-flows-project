import { fault, formatError, success } from '$lib/utils';
import { AuthUserEmailSchema } from '$lib/validationSchema';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';
import supabase from '$lib/admin';

export const actions: Actions = {
	default: async (event) => {
		const { request } = event;
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

		const { error } = await supabase.auth.admin.inviteUserByEmail(email);

		if (error) {
			return fail(500, fault(error.message, { email }));
		}

		return success('Invite was sent successfully to your friend.');
	}
};
