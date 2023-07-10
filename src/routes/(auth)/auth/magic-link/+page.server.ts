import { fault, formatError, success } from '$lib/utils';
import { AuthUserEmailSchema } from '$lib/validationSchema';
import { fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
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

		const { error } = await supabase.auth.signInWithOtp({
			email
		});

		if (error) {
			return fail(500, fault('Server error. Try again later.', { email }));
		}

		return success('Please check your email for a magic link to log into the website.');
	}
};
