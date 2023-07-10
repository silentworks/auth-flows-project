import { redirect } from '@sveltejs/kit';
import { loadFlashMessage } from 'sveltekit-flash-message/server';

export const load = loadFlashMessage(async ({ url, locals: { getSession } }) => {
	const session = await getSession();

	// only allow the signout subpath when visiting the auth path
	if (url.pathname !== '/auth/signout' && session) {
		throw redirect(303, '/');
	}
});
