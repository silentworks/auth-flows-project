import { formatError } from '$lib/utils';
import { AuthTokenSchema } from '$lib/validationSchema';
import { redirect } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { setFlash } from 'sveltekit-flash-message/server';

export const GET = async (event) => {
	const {
		url,
		locals: { supabase }
	} = event;
	const token = url.searchParams.get('token') as string;

	try {
		AuthTokenSchema.parse({ token });
	} catch (err) {
		if (err instanceof ZodError) {
			const errors = formatError(err);
			setFlash({ type: 'error', message: errors['token'] }, event);
			throw redirect(303, '/auth/invite');
		}
	}

	const { error: dbError } = await supabase.auth.verifyOtp({
		token_hash: token,
		type: 'invite'
	});

	if (dbError) {
		setFlash({ type: 'error', message: dbError.message }, event);
		throw redirect(303, '/auth/invite');
	}

	throw redirect(303, '/account/update-password');
};
