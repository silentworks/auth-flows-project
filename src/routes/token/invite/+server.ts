import { formatError } from '$lib/utils';
import { AuthTokenSchema } from '$lib/validationSchema';
import { redirect } from '@sveltejs/kit';
import { ZodError } from 'zod';

export const GET = async ({ url, locals: { supabase } }) => {
	const token = url.searchParams.get('token') as string;

	try {
		AuthTokenSchema.parse({ token });
	} catch (err) {
		if (err instanceof ZodError) {
			const errors = formatError(err);
			throw redirect(303, `/auth/magic-link?error=true&${new URLSearchParams(errors).toString()}`);
		}
	}

	const { error: dbError } = await supabase.auth.verifyOtp({
		token_hash: token,
		type: 'signup'
	});

	if (dbError) {
		throw redirect(303, `/auth/magic-link?error=true&message${dbError.message}`);
	}

	throw redirect(303, '');
};
