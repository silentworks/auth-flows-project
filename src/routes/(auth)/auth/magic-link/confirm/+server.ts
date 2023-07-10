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
			setFlash(
				{
					type: 'error',
					message: 'Your token is invalid, please request a new one using the form below.'
				},
				event
			);
			throw redirect(303, '/auth/magic-link');
		}
	}

	const { error: magicLinkError } = await supabase.auth.verifyOtp({
		token_hash: token,
		type: 'magiclink' // TODO: this should be email, but there is a bug when using token hash that doesn't allow email for now
	});

	if (magicLinkError) {
		// TODO: this is only provided because token hash method doesn't support the `email` type as yet, this is just a workaround
		const { error: signUpError } = await supabase.auth.verifyOtp({
			token_hash: token,
			type: 'signup' // TODO: this should be email, but there is a bug when using token hash that doesn't allow email for now
		});

		if (signUpError) {
			setFlash(
				{
					type: 'error',
					message:
						'Your email link is invalid or has expired, please request a new one using the form below.'
				},
				event
			);
			throw redirect(303, '/auth/magic-link');
		}
	}

	throw redirect(303, '/');
};
